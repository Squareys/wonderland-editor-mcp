import { z } from "zod";

const SafeRecord = z.record(z.string(), z.any());

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
  includeFilter: SafeRecord.describe(
    "Optional properties to match. Name will be matched with contains substring comparison rather than full comparison. Leave out to disable this filtering."
  ).optional(),
  excludeFilter: SafeRecord.describe(
    "Optional properties, which will exclude items from the list if match. Name will be matched with contains substring comparison rather than full comparison. Leave out to disable this filtering."
  ).optional(),
  paths: z
    .string()
    .array()
    .optional()
    .describe(
      'List of paths to filter each object by to reduce output (similar to GraphQL APIs), e.g. "name" will return only the object\'s name for each object.'
    ),
};

export const querySettingsSchema = {
  paths: z
    .string()
    .array()
    .optional()
    .describe("List of settings paths to filter by, e.g. physics.enabled"),
};

export const modifySettingsSchema = {
  changeSettings: SafeRecord.optional().describe(
    'Nested partial settings object to merge. Example: {"physx": {"enable": true}, "editor": {"importPhysicalAsPhongMaterials": true}}.'
  ),
  resetPaths: z
    .string()
    .array()
    .optional()
    .describe(
      "Settings paths to reset, separated by '.', e.g. `editor.importPhysicalAsPhongMaterials`"
    ),
};

export const deleteObjectsSchema = {
  objectIds: z.string().array(),
};

export const modifyObjectsSchema = {
  modifications: z
    .object({
      name: z.string().describe("Name for the object").optional(),
      id: z
        .string()
        .describe("ID of the object. Creates a new object, if not set.")
        .optional(),
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
          properties: z.record(z.string(), z.any()).optional(),
        })
        .array()
        .describe(
          "Components to add, specify the type and the properties to set."
        )
        .optional(),
      modifyComponents: z
        .object({
          index: z.number(),
          properties: z.record(z.string(), z.any()).optional(),
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
      id: z
        .string()
        .describe(
          "ID of the resource to modify. If omitted, a new resource will be created (where supported)."
        )
        .optional(),
      changeProperties: SafeRecord.optional().describe("Properties to change."),
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
    })
    .array(),
};

export const importFilesSchema = {
  imports: z
    .string()
    .describe(
      "Path of the scene file relative to the project file. Formats are preferred in this order: GLB, FBX, GLTF, OBJ, PLY"
    )
    .array(),
};

export const computeMeshBoundsSchema = {
  meshIds: z.string().array(),
};

export const computeObjectBoundsSchema = {
  objectIds: z.string().array(),
};
