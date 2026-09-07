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
        public void ApplyTint()
        {
            var block = new MaterialPropertyBlock();
            foreach (var renderer in GetComponentsInChildren<Renderer>(true))
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
                    renderer.SetPropertyBlock(block, index);
                }
            }
        }
    }
}
