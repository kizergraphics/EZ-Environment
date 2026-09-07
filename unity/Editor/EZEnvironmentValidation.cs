// Batch entry point used by the repository's isolated Unity validation project.
using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace EZEnvironment.Editor
{
    public static class EZEnvironmentValidation
    {
        [Serializable] private class Report { public bool passed, windMetadataVerified; public string unityVersion, scene, error; public int instances, lodGroups, colliders, sharedMeshes; }
        private static void Check(bool condition, string message) { if (!condition) throw new Exception("Validation failed: " + message); }
        public static void Run()
        {
            string project = Directory.GetParent(Application.dataPath).FullName;
            var report = new Report { unityVersion = Application.unityVersion };
            try
            {
                string[] arguments = Environment.GetCommandLineArgs();
                int fixtureArgument = Array.IndexOf(arguments, "-ezFixture");
                string fixture = fixtureArgument >= 0 ? Path.GetFullPath(arguments[fixtureArgument + 1]) : Path.Combine(project, "Fixture", "manifest.json");
                string fixtureRoot = Path.GetDirectoryName(fixture);
                var manifest = JsonUtility.FromJson<EZEnvironmentImporter.Manifest>(File.ReadAllText(fixture));
                var root = EZEnvironmentImporter.ImportManifest(fixture);
                int expected = manifest.chunks.Sum(chunk => chunk.count);
                var instances = root.GetComponentsInChildren<EZEnvironmentInstance>(true);
                Check(instances.Length == expected, "Instance count differs from manifest");
                Check(root.GetComponentsInChildren<LODGroup>(true).Length == expected, "Missing LOD groups");
                foreach (var instance in instances)
                {
                    var definition = manifest.assets.First(asset => asset.id == instance.assetId);
                    Check(instance.wind == (definition.wind != null && definition.wind.enabled), "Wind eligibility differs from manifest");
                    Check((instance.windAttribute ?? "") == (definition.wind?.attribute ?? ""), "Wind attribute differs from manifest");
                    Check(instance.GetComponent<LODGroup>().GetLODs().Length == definition.lods.Length, "LOD count mismatch");
                    foreach (var level in instance.GetComponent<LODGroup>().GetLODs()) Check(level.renderers.Length > 0, "Empty LOD renderers");
                    if (definition.collider.mode == "none") Check(instance.GetComponent<Collider>() == null, "Unexpected collider");
                    else Check(instance.GetComponent<Collider>() != null, "Missing configured collider");
                    var convex = instance.GetComponent<MeshCollider>();
                    if (convex != null) { Check(convex.convex && convex.sharedMesh != null, "Invalid convex collider"); Check(convex.sharedMesh.triangles.Length / 3 <= 255, "Convex face limit exceeded"); }
                }
                foreach (var descriptor in manifest.chunks)
                {
                    var data = JsonUtility.FromJson<EZEnvironmentImporter.ChunkData>(File.ReadAllText(Path.Combine(fixtureRoot, descriptor.file)));
                    var chunk = root.transform.Find("Chunk " + descriptor.id);
                    foreach (var layer in data.layers)
                    {
                        var layerObject = chunk.Find(layer.name);
                        for (int i = 0; i < layer.instances.Length; i++)
                        {
                            var source = layer.instances[i]; var actual = layerObject.GetChild(i);
                            Check(Vector3.Distance(actual.localPosition, new Vector3(-source.position[0], source.position[1], source.position[2])) < .0001f, "Coordinate reflection or position mismatch");
                            Check(Quaternion.Angle(actual.localRotation, new Quaternion(source.rotation[0], -source.rotation[1], -source.rotation[2], source.rotation[3])) < .02f, "Coordinate rotation mismatch");
                            Check(Mathf.Abs(actual.GetComponent<EZEnvironmentInstance>().tint - source.tint) < .00001f, "Tint mismatch");
                        }
                    }
                }
                Check(root.transform.Find("terrain") != null, "Terrain missing");
                var meshes = root.GetComponentsInChildren<MeshFilter>(true).Select(filter=>filter.sharedMesh).ToArray();
                Check(meshes.Distinct().Count() < meshes.Length, "Instances do not share mesh assets");
                report.scene = "Assets/Validation.unity";
                EditorSceneManager.SaveScene(root.scene, report.scene);
                EditorSceneManager.OpenScene(report.scene);
                var reopened = UnityEngine.Object.FindObjectsByType<EZEnvironmentInstance>(FindObjectsInactive.Include, FindObjectsSortMode.None);
                Check(reopened.Length == expected, "Instances lost after saving and reopening scene");
                foreach (var instance in reopened) {
                    instance.ApplyTint(); Check(instance.GetComponentsInChildren<MeshFilter>(true).All(filter=>filter.sharedMesh!=null), "Mesh resource lost after scene reload");
                    var definition = manifest.assets.First(asset => asset.id == instance.assetId);
                    Check(instance.wind == (definition.wind != null && definition.wind.enabled), "Wind eligibility lost after scene reload");
                    Check((instance.windAttribute ?? "") == (definition.wind?.attribute ?? ""), "Wind attribute lost after scene reload");
                }
                report.instances = expected; report.lodGroups = reopened.Length; report.colliders = reopened.Count(instance=>instance.GetComponent<Collider>()!=null); report.sharedMeshes = meshes.Distinct().Count(); report.windMetadataVerified = true; report.passed = true;
                File.WriteAllText(Path.Combine(project,"validation-report.json"),JsonUtility.ToJson(report,true));
                Debug.Log("EZ_ENVIRONMENT_VALIDATION_PASSED " + JsonUtility.ToJson(report));
                EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                report.error = error.ToString(); File.WriteAllText(Path.Combine(project,"validation-report.json"),JsonUtility.ToJson(report,true)); Debug.LogException(error); EditorApplication.Exit(1);
            }
        }

        public static void RenderPreview()
        {
            string project = Directory.GetParent(Application.dataPath).FullName;
            try
            {
                EditorSceneManager.OpenScene("Assets/Validation.unity");
                RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
                RenderSettings.ambientSkyColor = new Color(.55f,.6f,.68f);
                RenderSettings.ambientEquatorColor = new Color(.32f,.35f,.3f);
                RenderSettings.ambientGroundColor = new Color(.15f,.16f,.12f);
                var light = new GameObject("Preview Sun").AddComponent<Light>(); light.type = LightType.Directional; light.intensity = 1.4f; light.transform.rotation = Quaternion.Euler(48,-35,0); light.shadows = LightShadows.Soft;
                var camera = new GameObject("Preview Camera").AddComponent<Camera>();
                bool fullScene = UnityEngine.Object.FindObjectsByType<EZEnvironmentInstance>(FindObjectsSortMode.None).Length > 40;
                camera.transform.position = fullScene ? new Vector3(80,48,95) : new Vector3(17,13,21); camera.transform.LookAt(fullScene ? new Vector3(0,12,0) : new Vector3(0,1,0)); camera.fieldOfView = 48; camera.nearClipPlane = .1f; camera.farClipPlane = 1000; camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = new Color(.15f,.2f,.23f);
                foreach (var group in UnityEngine.Object.FindObjectsByType<LODGroup>(FindObjectsSortMode.None)) group.ForceLOD(0);
                var render = new RenderTexture(1920,1080,24); camera.targetTexture = render; camera.Render(); RenderTexture.active = render;
                var image = new Texture2D(1920,1080,TextureFormat.RGB24,false); image.ReadPixels(new Rect(0,0,1920,1080),0,0); image.Apply();
                File.WriteAllBytes(Path.Combine(project,"unity-preview.png"),image.EncodeToPNG());
                RenderTexture.active = null; camera.targetTexture = null; render.Release(); UnityEngine.Object.DestroyImmediate(render); UnityEngine.Object.DestroyImmediate(image);
                Debug.Log("EZ_ENVIRONMENT_PREVIEW_RENDERED " + SystemInfo.graphicsDeviceName);
                EditorApplication.Exit(0);
            }
            catch (Exception error) { Debug.LogException(error); EditorApplication.Exit(1); }
        }
    }
}
