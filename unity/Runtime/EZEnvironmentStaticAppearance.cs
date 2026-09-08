using UnityEngine;

namespace EZEnvironment
{
    // Static grove/legacy tree imports also need glTFast Built-in shadow aliases.
    [ExecuteAlways]
    public sealed class EZEnvironmentStaticAppearance : MonoBehaviour
    {
        private void OnEnable() => Apply();
        private void OnValidate() => Apply();
        public void Apply() => EZEnvironmentInstance.ApplyAppearance(GetComponentsInChildren<Renderer>(true), 1);
    }
}
