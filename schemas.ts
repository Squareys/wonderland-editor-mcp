import { z } from "zod";

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
    .object({})
    .passthrough()
    .describe(
      "Optional properties to match. Name will be matched with contains substring comparison rather than full comparison. Leave out to disable this filtering."
    )
    .optional(),
  excludeFilter: z
    .object({})
    .passthrough()
    .describe(
      "Optional properties, which will exclude items from the list if match. Name will be matched with contains substring comparison rather than full comparison. Leave out to disable this filtering."
    )
    .optional(),
};

export const modifyObjectsSchema = {
  modifications: z
    .object({
      name: z.string().describe("Name for the object").optional(),
      id: z.string().describe("ID of the object").optional(),
      parentId: z
        .string()
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
          properties: z.object({}).passthrough(),
        })
        .array()
        .describe(
          "Components to add to the object, any object in the format {type: string, [type]: {properties}}"
        )
        .optional(),
      modifyComponents: z
        .object({
          index: z.number(),
          properties: z.object({}).passthrough(),
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
