// Copy the unity folder into Assets/EZEnvironment in a Unity project.
// Install com.unity.cloud.gltfast through Package Manager before importing.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace EZEnvironment.Editor
{
    public static class EZEnvironmentImporter
    {
        [Serializable] public class Coordinates { public string handedness, up, units, quaternion; }
        [Serializable] public class FileEntry { public string path; public long bytes; }
        [Serializable] public class ColliderData { public string mode; public float[] center, size, vertices; public float radius; public int[] indices; }
        [Serializable] public class WindData { public bool enabled; public string attribute; }
        [Serializable] public class Lod { public int level, triangles; public string file; public float screenRelativeHeight; }
        [Serializable] public class Asset { public string id, definitionHash, preset; public Lod[] lods; public ColliderData collider; public WindData wind; }
        [Serializable] public class Chunk { public string id, file; public int x, z, count; }
        [Serializable] public class StaticObject { public string id, file; }
        [Serializable] public class Manifest { public string format, kind; public int version; public Coordinates coordinates; public Asset[] assets; public Chunk[] chunks; public StaticObject[] staticObjects; public FileEntry[] files; }
        [Serializable] public class Instance { public string asset; public float[] position, rotation, scale; public float tint = 1; public uint variationSeed; }
        [Serializable] public class Layer { public string name; public Instance[] instances; }
        [Serializable] public class ChunkData { public int version, x, z; public string id; public Layer[] layers; }

        [MenuItem("Tools/EZ Environment/Import Extracted Pack...")]
        public static void ImportPack()
        {
            string selected = EditorUtility.OpenFilePanel("Choose an extracted EZ Environment manifest", "", "json");
            if (string.IsNullOrEmpty(selected)) return;
            try { ImportManifest(selected); }
            catch (Exception error) { Debug.LogException(error); EditorUtility.DisplayDialog("EZ Environment import failed", error.Message, "OK"); }
            finally { EditorUtility.ClearProgressBar(); }
        }

        public static GameObject ImportManifest(string selected)
        {
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(selected));
            ValidateHeader(manifest);
            string source = Path.GetDirectoryName(Path.GetFullPath(selected));
            var inventory = new HashSet<string>();
            foreach (var file in manifest.files)
            {
                string path = SafeFile(source, file.path);
                if (!inventory.Add(file.path) || !File.Exists(path) || new FileInfo(path).Length != file.bytes) throw new InvalidDataException("Missing, duplicate, or damaged pack file: " + file.path);
            }
            var definitions = new Dictionary<string, Asset>();
            foreach (var asset in manifest.assets)
            {
                if (string.IsNullOrWhiteSpace(asset.id) || definitions.ContainsKey(asset.id) || asset.lods == null || asset.lods.Length == 0) throw new InvalidDataException("Invalid or duplicate asset.");
                definitions.Add(asset.id, asset);
                RequireFile(inventory, asset.preset);
                float threshold = 1.01f;
                for (int i = 0; i < asset.lods.Length; i++)
                {
                    var lod = asset.lods[i]; RequireFile(inventory, lod.file);
                    if (lod.level != i || lod.triangles <= 0 || lod.screenRelativeHeight <= 0 || lod.screenRelativeHeight >= threshold) throw new InvalidDataException("Invalid LOD for " + asset.id);
                    threshold = lod.screenRelativeHeight;
                }
                ValidateCollider(asset.collider);
            }
            var chunks = new List<ChunkData>();
            var chunkIDs = new HashSet<string>();
            foreach (var descriptor in manifest.chunks ?? Array.Empty<Chunk>())
            {
                RequireFile(inventory, descriptor.file);
                var chunk = JsonUtility.FromJson<ChunkData>(File.ReadAllText(SafeFile(source, descriptor.file)));
                if (chunk == null || chunk.version != 1 || chunk.id != descriptor.id || chunk.x != descriptor.x || chunk.z != descriptor.z || chunk.layers == null || !chunkIDs.Add(chunk.id)) throw new InvalidDataException("Invalid chunk " + descriptor.id);
                int count = 0;
                foreach (var layer in chunk.layers)
                {
                    if (layer.instances == null) throw new InvalidDataException("Missing instance list.");
                    foreach (var instance in layer.instances)
                    {
                        if (!definitions.ContainsKey(instance.asset)) throw new InvalidDataException("Unknown species: " + instance.asset);
                        ValidateInstance(instance); count++;
                    }
                }
                if (count != descriptor.count) throw new InvalidDataException("Instance count mismatch for " + descriptor.id);
                chunks.Add(chunk);
            }
            foreach (var entry in manifest.staticObjects ?? Array.Empty<StaticObject>()) RequireFile(inventory, entry.file);

            // glTFast's Editor importer creates persistent native meshes, textures,
            // materials and prefabs. No transient runtime importer objects leak into
            // the saved scene, and all instances share imported mesh resources.
            const string importRoot = "Assets/EZEnvironmentImports";
            if (!AssetDatabase.IsValidFolder(importRoot)) AssetDatabase.CreateFolder("Assets", "EZEnvironmentImports");
            string destination = AssetDatabase.GenerateUniqueAssetPath(importRoot + "/Environment");
            Directory.CreateDirectory(destination);
            foreach (var file in manifest.files)
            {
                string target = SafeFile(Path.GetFullPath(destination), file.path);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                File.Copy(SafeFile(source, file.path), target, false);
            }
            File.Copy(selected, Path.Combine(destination, "manifest.json"), false);
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var lodAssets = new Dictionary<string, GameObject[]>();
            foreach (var asset in manifest.assets) lodAssets[asset.id] = asset.lods.Select(lod => LoadGLB(destination, lod.file)).ToArray();
            var statics = (manifest.staticObjects ?? Array.Empty<StaticObject>()).ToDictionary(entry => entry.id, entry => LoadGLB(destination, entry.file));

            var root = new GameObject("EZ Environment");
            Undo.RegisterCreatedObjectUndo(root, "Import EZ Environment");
            try
            {
                var convexMeshes = new Dictionary<string, Mesh>();
                foreach (var asset in manifest.assets)
                {
                    if (asset.collider?.mode != "convex") continue;
                    var data = asset.collider;
                    var mesh = new Mesh { name = asset.id + " Collision" };
                    mesh.vertices = Enumerable.Range(0, data.vertices.Length / 3).Select(i => new Vector3(-data.vertices[i * 3], data.vertices[i * 3 + 1], data.vertices[i * 3 + 2])).ToArray();
                    var indices = (int[])data.indices.Clone();
                    for (int i = 0; i < indices.Length; i += 3) { int temp = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = temp; }
                    mesh.triangles = indices; mesh.RecalculateNormals(); mesh.RecalculateBounds();
                    AssetDatabase.CreateAsset(mesh, AssetDatabase.GenerateUniqueAssetPath(destination + "/Collider.asset"));
                    convexMeshes[asset.id] = mesh;
                }
                int created = 0;
                foreach (var chunk in chunks)
                {
                    if (EditorUtility.DisplayCancelableProgressBar("Importing EZ Environment", "Chunk " + chunk.id, (float)created / Math.Max(1, chunks.Count))) throw new OperationCanceledException("Import cancelled. The imported pack files remain available for retry.");
                    var chunkRoot = new GameObject("Chunk " + chunk.id); chunkRoot.transform.SetParent(root.transform, false);
                    // Positions in chunk JSON are world-space relative to the pack
                    // root; chunk parents intentionally have an identity transform.
                    foreach (var layer in chunk.layers)
                    {
                        var layerRoot = new GameObject(layer.name); layerRoot.transform.SetParent(chunkRoot.transform, false);
                        foreach (var instance in layer.instances) CreateInstance(instance, definitions[instance.asset], lodAssets[instance.asset], convexMeshes, layerRoot.transform);
                    }
                    created++;
                }
                if (manifest.kind == "asset") foreach (var asset in manifest.assets) CreateInstance(new Instance { asset = asset.id, position = new[] { 0f, 0f, 0f }, rotation = new[] { 0f, 0f, 0f, 1f }, scale = new[] { 1f, 1f, 1f }, tint = 1 }, asset, lodAssets[asset.id], convexMeshes, root.transform);
                foreach (var entry in statics) { var instance = (GameObject)PrefabUtility.InstantiatePrefab(entry.Value, root.transform); instance.name = entry.Key; }
                AssetDatabase.SaveAssets();
                PrefabUtility.SaveAsPrefabAsset(root, destination + "/Environment.prefab");
                EditorSceneManager.MarkSceneDirty(root.scene);
                Selection.activeGameObject = root;
                Debug.Log("Imported EZ Environment to " + destination + ". Save your scene to retain the instance.");
                return root;
            }
            catch { UnityEngine.Object.DestroyImmediate(root); throw; }
        }

        private static void CreateInstance(Instance data, Asset asset, GameObject[] lodAssets, Dictionary<string, Mesh> convexMeshes, Transform parent)
        {
            var holder = new GameObject(asset.id); holder.transform.SetParent(parent, false);
            holder.transform.localPosition = Position(data.position);
            // glTFast mirrors X when converting right-handed glTF to Unity.
            holder.transform.localRotation = new Quaternion(data.rotation[0], -data.rotation[1], -data.rotation[2], data.rotation[3]);
            holder.transform.localScale = new Vector3(data.scale[0], data.scale[1], data.scale[2]);
            var levels = new LOD[lodAssets.Length];
            for (int i = 0; i < lodAssets.Length; i++)
            {
                var child = (GameObject)PrefabUtility.InstantiatePrefab(lodAssets[i], holder.transform);
                child.name = "LOD " + i;
                levels[i] = new LOD(asset.lods[i].screenRelativeHeight, child.GetComponentsInChildren<Renderer>(true));
                foreach (var renderer in levels[i].renderers) foreach (var material in renderer.sharedMaterials) if (material != null) material.enableInstancing = true;
            }
            var group = holder.AddComponent<LODGroup>(); group.SetLODs(levels); group.RecalculateBounds();
            var metadata = holder.AddComponent<EZEnvironmentInstance>(); metadata.assetId = asset.id; metadata.definitionHash = asset.definitionHash; metadata.tint = data.tint; metadata.variationSeed = data.variationSeed; metadata.wind = asset.wind != null && asset.wind.enabled; metadata.windAttribute = asset.wind?.attribute; metadata.ApplyTint();
            var collider = asset.collider;
            if (collider?.mode == "box") { var component = holder.AddComponent<BoxCollider>(); component.center = Position(collider.center); component.size = new Vector3(collider.size[0], collider.size[1], collider.size[2]); }
            else if (collider?.mode == "sphere") { var component = holder.AddComponent<SphereCollider>(); component.center = Position(collider.center); component.radius = collider.radius; }
            else if (collider?.mode == "convex") { var component = holder.AddComponent<MeshCollider>(); component.sharedMesh = convexMeshes[asset.id]; component.convex = true; }
        }

        private static GameObject LoadGLB(string root, string file)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(root + "/" + file);
            if (prefab == null) throw new InvalidOperationException("Cannot import " + file + ". Install Unity glTFast (com.unity.cloud.gltfast) in Package Manager, ensure it is the default .glb importer, then retry.");
            return prefab;
        }
        private static Vector3 Position(float[] value) => new Vector3(-value[0], value[1], value[2]);
        private static void RequireFile(HashSet<string> inventory, string path) { if (path == null || !inventory.Contains(path)) throw new InvalidDataException("Reference absent from file inventory: " + path); }
        private static string SafeFile(string root, string relative)
        {
            if (string.IsNullOrWhiteSpace(relative) || relative.Contains('\\') || relative.Contains(':') || Path.IsPathRooted(relative) || relative.Split('/').Any(part => part == "" || part == "." || part == "..")) throw new InvalidDataException("Unsafe file path: " + relative);
            string path = Path.GetFullPath(Path.Combine(root, relative));
            if (!path.StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("File escapes pack folder.");
            return path;
        }
        private static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
        private static bool Vector(float[] value, int size) => value != null && value.Length == size && value.All(Finite);
        private static void ValidateInstance(Instance instance)
        {
            if (!Vector(instance.position, 3) || !Vector(instance.rotation, 4) || !Vector(instance.scale, 3) || instance.scale.Any(value => value <= 0) || !Finite(instance.tint) || instance.tint < 0 || Mathf.Abs(instance.rotation.Sum(value => value * value) - 1) > .0001f) throw new InvalidDataException("Invalid placement transform or tint.");
        }
        private static void ValidateCollider(ColliderData collider)
        {
            if (collider == null || !new[] { "none", "box", "sphere", "convex" }.Contains(collider.mode)) throw new InvalidDataException("Unsupported collider.");
            if (collider.mode == "box" && (!Vector(collider.center, 3) || !Vector(collider.size, 3) || collider.size.Any(value => value <= 0))) throw new InvalidDataException("Invalid box collider.");
            if (collider.mode == "sphere" && (!Vector(collider.center, 3) || !Finite(collider.radius) || collider.radius <= 0)) throw new InvalidDataException("Invalid sphere collider.");
            if (collider.mode == "convex" && (collider.vertices == null || collider.vertices.Length % 3 != 0 || collider.vertices.Length < 12 || !collider.vertices.All(Finite) || collider.indices == null || collider.indices.Length < 12 || collider.indices.Length % 3 != 0 || collider.indices.Length / 3 > 255 || collider.indices.Any(index => index < 0 || index >= collider.vertices.Length / 3))) throw new InvalidDataException("Invalid convex collider or Unity's 255-face limit exceeded.");
        }
        private static void ValidateHeader(Manifest manifest)
        {
            if (manifest == null || manifest.format != "ez-environment" || manifest.version != 1 || (manifest.kind != "environment" && manifest.kind != "asset") || manifest.assets == null || manifest.files == null) throw new InvalidDataException("Expected an EZ Environment version 1 manifest.");
            var c = manifest.coordinates;
            if (c == null || c.units != "meters" || c.handedness != "right" || c.up != "Y" || c.quaternion != "xyzw") throw new InvalidDataException("Unsupported coordinate convention.");
        }
    }
}
