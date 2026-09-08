// Optional batch validation entry point; requires glTFast and an extracted pack.
using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace EZEnvironment.Editor
{
    public static class EZEnvironmentMaterialValidation
    {
        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException("Material validation failed: " + message);
        }

        public static void Run()
        {
            try
            {
                var arguments = Environment.GetCommandLineArgs();
                int index = Array.IndexOf(arguments, "-ezFixture");
                string fixture = index >= 0 ? Path.GetFullPath(arguments[index + 1]) : Path.Combine(Directory.GetParent(Application.dataPath).FullName, "Fixture", "manifest.json");
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var root = EZEnvironmentImporter.ImportManifest(fixture);
                var renderers = root.GetComponentsInChildren<Renderer>(true);
                Check(renderers.Length > 0, "No renderers imported");
                foreach (var renderer in renderers)
                {
                    var source = PrefabUtility.GetCorrespondingObjectFromSource(renderer);
                    Check(source != null, "Imported renderer lost its prefab source");
                    for (int i = 0; i < renderer.sharedMaterials.Length; i++)
                    {
                        var material = renderer.sharedMaterials[i];
                        var original = source.sharedMaterials[i];
                        Check(material != original && AssetDatabase.GetAssetPath(material).EndsWith(".mat"), "Material is not an editable .mat asset");
                        Check(material.shader == original.shader && material.renderQueue == original.renderQueue && material.doubleSidedGI == original.doubleSidedGI && material.shaderKeywords.OrderBy(value => value).SequenceEqual(original.shaderKeywords.OrderBy(value => value)), "Imported shader state changed");
                        foreach (string property in original.GetTexturePropertyNames())
                        {
                            var sourceTexture = original.GetTexture(property);
                            var texture = material.GetTexture(property);
                            if (sourceTexture == null) { Check(texture == null, "Unexpected texture"); continue; }
                            Check(texture != sourceTexture && AssetDatabase.GetAssetPath(texture).EndsWith(".asset"), "Texture is not an independent native asset");
                            Check(texture.width == sourceTexture.width && texture.height == sourceTexture.height && texture.graphicsFormat == sourceTexture.graphicsFormat && texture.mipmapCount == sourceTexture.mipmapCount && texture.wrapModeU == sourceTexture.wrapModeU && texture.wrapModeV == sourceTexture.wrapModeV && texture.filterMode == sourceTexture.filterMode, "Texture or sampler changed");
                            Check(material.GetTextureScale(property) == original.GetTextureScale(property) && material.GetTextureOffset(property) == original.GetTextureOffset(property), "Texture transform changed");
                        }
                    }
                }
                string scene = "Assets/MaterialValidation.unity";
                int materialCount = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().Count();
                int rendererCount = renderers.Length;
                Check(EditorSceneManager.SaveScene(root.scene, scene), "Unable to save scene");
                EditorSceneManager.OpenScene(scene);
                var reopened = UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsInactive.Include, FindObjectsSortMode.None);
                Check(reopened.Length == rendererCount, "Renderers lost after reopening");
                var materials = reopened.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
                Check(materials.Length == materialCount && materials.All(material => material != null && AssetDatabase.GetAssetPath(material).EndsWith(".mat")), "Material assignments lost after reopening");
                Debug.Log("EZ_ENVIRONMENT_MATERIAL_VALIDATION_PASSED renderers=" + rendererCount + " sharedEditableMaterials=" + materialCount);
                EditorApplication.Exit(0);
            }
            catch (Exception error) { Debug.LogException(error); EditorApplication.Exit(1); }
        }
    }
}
