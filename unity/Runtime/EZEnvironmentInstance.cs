using UnityEngine;

namespace EZEnvironment
{
    // Metadata survives prefab/scene round trips. Tint uses shared materials and
    // is reapplied on scene load, unlike a one-time Editor property block.
    [ExecuteAlways]
    public sealed class EZEnvironmentInstance : MonoBehaviour
    {
        public string assetId;
        public string definitionHash;
        public float tint = 1;
        public uint variationSeed;
        public bool wind;
        public string windAttribute;
        private void OnEnable() => ApplyTint();
        private void OnValidate() => ApplyTint();
        public void ApplyTint() => ApplyAppearance(GetComponentsInChildren<Renderer>(true), tint);

        public static void ApplyAppearance(Renderer[] renderers, float tint)
        {
            var block = new MaterialPropertyBlock();
            foreach (var renderer in renderers)
            {
                var materials = renderer.sharedMaterials;
                for (int index = 0; index < materials.Length; index++)
                {
                    var material = materials[index];
                    if (material == null) continue;
                    block.Clear(); renderer.GetPropertyBlock(block, index);
                    foreach (string property in new[] { "_BaseColor", "_Color", "baseColorFactor" })
                    {
                        if (!material.HasProperty(property)) continue;
                        Color color = material.GetColor(property); color.r *= tint; color.g *= tint; color.b *= tint;
                        block.SetColor(property, color);
                    }
                    // glTFast's Built-in ShadowCaster uses UnityStandardShadow,
                    // which samples legacy uniforms rather than its glTF names.
                    // Supply those uniforms per renderer without changing shared
                    // imported materials or affecting URP/HDRP shaders.
                    if (material.shader.name == "glTF/PbrMetallicRoughness" && material.IsKeywordEnabled("_ALPHATEST_ON"))
                    {
                        block.SetTexture("_MainTex", material.GetTexture("baseColorTexture"));
                        Color factor = material.GetColor("baseColorFactor");
                        factor.r *= tint; factor.g *= tint; factor.b *= tint;
                        block.SetColor("_Color", factor);
                        block.SetFloat("_Cutoff", material.GetFloat("alphaCutoff"));
                        Vector2 scale = material.GetTextureScale("baseColorTexture");
                        Vector2 offset = material.GetTextureOffset("baseColorTexture");
                        block.SetVector("_MainTex_ST", new Vector4(scale.x, scale.y, offset.x, offset.y));
                    }
                    renderer.SetPropertyBlock(block, index);
                }
            }
        }
    }
}
