/**
 * Reading a CloudFormation template the way CloudFormation reads it.
 *
 * A template written by hand uses the short intrinsic forms — `!Ref`, `!GetAtt`,
 * `!Sub` — because that is what makes it readable, and a template synthesised by CDK
 * uses the long ones. They are the same template. This module parses the short forms
 * into the long ones so that everything downstream compares meaning rather than
 * notation, and gives the parity harness the two operations it needs: renaming logical
 * ids, and flattening a template to the set of leaf paths a difference can hide in.
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";

/** Any JSON-shaped value. A template is one of these, once parsed. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** One resource of a template. The attributes are CloudFormation's, not a subset. */
export interface Resource {
  Type: string;
  Properties?: Json;
  DependsOn?: Json;
  Condition?: string;
  CreationPolicy?: Json;
  UpdatePolicy?: Json;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  Metadata?: Json;
}

export interface Template {
  AWSTemplateFormatVersion?: string;
  Transform?: Json;
  Description?: string;
  Parameters?: Record<string, Json>;
  Mappings?: Record<string, Json>;
  Conditions?: Record<string, Json>;
  Rules?: Record<string, Json>;
  Resources: Record<string, Resource>;
  Outputs?: Record<string, Json>;
}

/**
 * The short forms, each mapped to the function it abbreviates. `!GetAtt A.B.C` splits
 * at the FIRST dot only: the head is a logical id and the rest is an attribute path,
 * which is how `Endpoint.Address` stays one attribute rather than becoming two.
 */
const shortForms: { name: string; long: string; collection?: "seq" | "map" }[] = [
  { name: "Ref", long: "Ref" },
  { name: "GetAtt", long: "Fn::GetAtt" },
  { name: "Sub", long: "Fn::Sub" },
  { name: "Base64", long: "Fn::Base64" },
  { name: "GetAZs", long: "Fn::GetAZs" },
  { name: "ImportValue", long: "Fn::ImportValue" },
  { name: "Condition", long: "Condition" },
  { name: "Join", long: "Fn::Join", collection: "seq" },
  { name: "Select", long: "Fn::Select", collection: "seq" },
  { name: "Split", long: "Fn::Split", collection: "seq" },
  { name: "FindInMap", long: "Fn::FindInMap", collection: "seq" },
  { name: "If", long: "Fn::If", collection: "seq" },
  { name: "Equals", long: "Fn::Equals", collection: "seq" },
  { name: "And", long: "Fn::And", collection: "seq" },
  { name: "Or", long: "Fn::Or", collection: "seq" },
  { name: "Not", long: "Fn::Not", collection: "seq" },
  { name: "Cidr", long: "Fn::Cidr", collection: "seq" },
];

const customTags = shortForms.map(({ name, long, collection }) => ({
  tag: `!${name}`,
  ...(collection === undefined ? {} : { collection }),
  resolve: (value: unknown): Json => {
    const resolved = (
      collection === undefined ? value : (value as { toJSON(): Json }).toJSON()
    ) as Json;
    if (long === "Fn::GetAtt" && typeof resolved === "string") {
      const dot = resolved.indexOf(".");
      return { "Fn::GetAtt": [resolved.slice(0, dot), resolved.slice(dot + 1)] };
    }
    return { [long]: resolved };
  },
}));

/** A hand-written template, read from disk. */
export const readYamlTemplate = (path: string): Template =>
  parse(readFileSync(path, "utf8"), { customTags }) as Template;

/** A CDK template, read from the snapshot in `tests/baseline`. */
export const readJsonTemplate = (path: string): Template =>
  JSON.parse(readFileSync(path, "utf8")) as Template;

/**
 * Rewrite every logical id in a template through `names`, leaving any id the map does
 * not mention alone. This is what lets the harness compare a template whose ids were
 * chosen by a person against one whose ids were chosen by CDK's hashing: an id appears
 * as a resource key, inside `Ref` and `Fn::GetAtt`, in `DependsOn`, and as `${id}`
 * inside an `Fn::Sub` string, and all four are rewritten here.
 */
export const renameLogicalIds = (template: Template, names: Record<string, string>): Template => {
  const renamed = (id: string) => names[id] ?? id;

  const walk = (value: Json): Json => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== "object") return value;

    const entries = Object.entries(value);
    const [key, only] = entries[0] ?? [];
    if (entries.length === 1 && key === "Ref" && typeof only === "string") {
      return { Ref: renamed(only) };
    }
    if (entries.length === 1 && key === "Fn::GetAtt" && Array.isArray(only)) {
      const [head, ...rest] = only;
      return { "Fn::GetAtt": [renamed(head as string), ...rest] };
    }
    if (entries.length === 1 && key === "Fn::Sub" && typeof only === "string") {
      return {
        "Fn::Sub": only.replace(/\$\{([^!}]+)\}/g, (whole, id: string) =>
          id in names ? `\${${names[id]}}` : whole,
        ),
      };
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, walk(v as Json)]));
  };

  const resources: Record<string, Resource> = Object.fromEntries(
    Object.entries(template.Resources).map(([id, resource]) => {
      const dependsOn = resource.DependsOn;
      return [
        renamed(id),
        {
          ...(walk(resource as unknown as Json) as unknown as Resource),
          // One name and a list of one name mean the same thing to CloudFormation, and
          // the order within the list means nothing, so both are normalised here.
          ...(dependsOn === undefined
            ? {}
            : {
                DependsOn: (Array.isArray(dependsOn) ? dependsOn : [dependsOn])
                  .map((one) => renamed(one as string))
                  .sort(),
              }),
        },
      ];
    }),
  );

  return { ...(walk(template as unknown as Json) as object), Resources: resources } as Template;
};

/**
 * Every leaf of a template, keyed by its path. A comparison over these paths says
 * exactly WHERE two templates differ, which is the difference between a harness that
 * reports "not equal" and one a person can act on.
 */
export const leaves = (value: Json, prefix = ""): Map<string, Json> => {
  const found = new Map<string, Json>();
  const visit = (node: Json, path: string) => {
    if (Array.isArray(node)) {
      if (node.length === 0) found.set(path, node);
      node.forEach((child, index) => {
        visit(child, `${path}[${index}]`);
      });
      return;
    }
    if (node !== null && typeof node === "object") {
      const entries = Object.entries(node);
      if (entries.length === 0) found.set(path, node);
      for (const [key, child] of entries)
        visit(child as Json, path === "" ? key : `${path}.${key}`);
      return;
    }
    found.set(path, node);
  };
  visit(value, prefix);
  return found;
};

/** The leaf paths at which two templates disagree, in either direction. */
export const differingPaths = (left: Json, right: Json): string[] => {
  const a = leaves(left);
  const b = leaves(right);
  const paths = new Set([...a.keys(), ...b.keys()]);
  const differing: string[] = [];
  for (const path of paths) {
    if (JSON.stringify(a.get(path)) !== JSON.stringify(b.get(path))) differing.push(path);
  }
  return differing.sort();
};

/**
 * Collapse a set of differing leaf paths onto the prefixes that were declared. A
 * difference under `Resources.Api.Properties.Code` is covered by a declaration of
 * `Resources.Api.Properties.Code`, and array indices do not have to be enumerated.
 */
export const coveringPrefix = (path: string, prefixes: readonly string[]): string | undefined =>
  prefixes.find(
    (prefix) => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`),
  );
