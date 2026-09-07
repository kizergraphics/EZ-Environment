precision highp float;

varying vec3 vPosition;

uniform float uSunAzimuth; // Sun azimuth angle (in degrees)
uniform float uSunElevation; // Sun elevation angle (in degrees)
uniform vec3 uSunColor;
uniform vec3 uSkyColorLow;
uniform vec3 uSkyColorHigh;
uniform float uSunSize;

void main() {
    // Convert angles from degrees to radians
    float azimuth = radians(uSunAzimuth);
    float elevation = radians(uSunElevation);

    // Calculate the sun direction vector based on azimuth and elevation
    vec3 sunDirection = normalize(vec3(
        cos(elevation) * sin(azimuth),
        sin(elevation),
        cos(elevation) * cos(azimuth)
    ));

    // Normalize the fragment position
    vec3 direction = normalize(vPosition);

    // Gradient for the sky (simple blue gradient)
    // The visible horizon matches the scene fog color in linear light.
    float t = 1.0 - exp(-max(direction.y, 0.0) * 18.0);
    vec3 skyColor = mix(uSkyColorLow, uSkyColorHigh, t);

    // Compute sun appearance
    float alignment = max(dot(direction, sunDirection), 0.0);
    float sunIntensity = pow(alignment, 12000.0 / max(uSunSize, 0.01));
    vec3 sunColor = uSunColor * (sunIntensity * 2.4 + pow(alignment, 22.0) * 0.085);

    // Combine sun and sky color
    vec3 color = skyColor + sunColor;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
