import { z } from "zod";
import { validateSchemas } from "./validateSchemas.js";

export const ResourceTypes = [
  "objects",
  "textures",
  "meshes",
  "materials",
  "animations",
  "skins",
  "images",
  "shaders",
  "pipelines",
  "fonts",
  "morphTargets",
  "particleEffects",
] as const;

export const queryResourcesSchema = {
  resourceType: z.enum(ResourceTypes).describe("Type of resource to query."),
  ids: z
    .string()
    .array()
    .describe(
      "List of ids to query, leave out to list all resources of given type."
    )
    .optional(),
  includeFilter: z
    .record(z.string(), z.any())
    .describe(
      "Optional properties to match. Name will be matched with contains substring comparison rather than full comparison. Leave out to disable this filtering."
    )
    .optional(),
  excludeFilter: z
    .record(z.string(), z.any())
    .describe(
      "Optional properties, which will exclude items from the list if match. Name will be matched with contains substring comparison rather than full comparison. Leave out to disable this filtering."
    )
    .optional(),
};

export const querySettingsSchema = {};

const SafeRecord = z.record(z.string(), z.unknown());
export const modifySettingsSchema = {
  changeSettings: SafeRecord
    .optional()
    .describe(
      'Object of settings to override. Nested settings would be specified as {"physics": {"enabled": true}}.'
    ),
  resetSettings: z
    .string()
    .array()
    .optional()
    .describe(
      "Settings paths to reset, separated by '.', e.g. physics.enabled"
    ),
};

export const deleteObjectsSchema = {
  objectIds: z.string().array(),
};

export const modifyObjectsSchema = {
  modifications: z
    .object({
      name: z.string().describe("Name for the object").optional(),
      id: z.string().describe("ID of the object").optional(),
      parentId: z
        .string()
        .nullable()
        .describe("ID of the parent to parent to.")
        .optional(),
      position: z
        .number()
        .array()
        .length(3)
        .describe("Array of three numbers for position")
        .optional(),
      rotation: z
        .number()
        .array()
        .length(4)
        .describe("Array of four numbers for rotation quaternion")
        .optional(),
      scaling: z
        .number()
        .array()
        .length(3)
        .describe("Array of three numbers for scaling")
        .optional(),
      addComponents: z
        .object({
          type: z.string(),
          properties: z.record(z.string(), z.any()),
        })
        .array()
        .describe(
          "Components to add, specify the type and the properties to set."
        )
        .optional(),
      modifyComponents: z
        .object({
          index: z.number(),
          properties: z.record(z.string(), z.any()),
        })
        .array()
        .describe("Components to modify on the object.")
        .optional(),
      removeComponents: z
        .number()
        .array()
        .describe("Indices of components to remove from the object")
        .optional(),
    })
    .array(),
};

export const modifyResourcesSchema = {
  modifications: z
    .object({
      resourceType: z.enum(ResourceTypes).describe("Type of resource."),
      id: z.string().describe("ID of the resource to modify."),
      changeProperties: z
        .record(z.string(), z.any())
        .describe("Properties to change.")
        .optional(),
      resetProperties: z
        .string()
        .array()
        .describe("Property names to reset to their defaults.")
        .optional(),
    })
    .array(),
};

export const importSceneFilesSchema = {
  imports: z
    .object({
      path: z
        .string()
        .describe(
          "Path of the scene file relative to the project file. Formats are preferred in this order: GLB, FBX, GLTF, OBJ, PLY"
        ),
      parentId: z
        .string()
        .describe(
          "If set, the imported scene hierarchy ID will be reparented to this object, otherwise imported at the root."
        )
        .optional(),
    })
    .array(),
};

export const importFilesSchema = {
  imports: z
    .object({
      path: z
        .string()
        .describe(
          "Path of the scene file relative to the project file. Formats are preferred in this order: GLB, FBX, GLTF, OBJ, PLY"
        ),
    })
    .array(),
};

export const computeMeshBoundsSchema = {
  meshIds: z.string().array(),
};

// Validate all schemas in schemas.ts
const schemas = {
  queryResourcesSchema,
  querySettingsSchema,
  modifySettingsSchema,
  deleteObjectsSchema,
  modifyObjectsSchema,
  modifyResourcesSchema,
  importSceneFilesSchema,
  importFilesSchema,
  computeMeshBoundsSchema,
};

try {
  validateSchemas(schemas);
  console.log("All schemas are valid.");
} catch (error) {
  console.error("Schema validation failed:", error);
}
