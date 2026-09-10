/**
 * Reading a CloudFormation template the way CloudFormation reads it.
 *
 * A template written by hand uses the short intrinsic forms — `!Ref`, `!GetAtt`,
 * `!Sub` — because that is what makes it readable, and a template synthesised by CDK
 * uses the long ones. They are the same template. This module parses the short forms
 * into the long ones so that everything downstream compares meaning rather than
 * notation, and flattens a template to the set of leaf paths an assertion can look at.
 *
 * It was written for the parity harness, which compared these templates against the CDK
 * synth they were converted from. That harness is gone (`ID53`): its oracle was a frozen
 * snapshot from a tool no longer in the repository, so it could only ever grow an
 * exception list. What is left here is what the invariants use.
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
