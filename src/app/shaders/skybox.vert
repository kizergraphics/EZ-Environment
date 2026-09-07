varying vec3 vPosition;

void main() {
    vPosition = position;
    // Center only the visual sky on the camera. Its child lights remain in
    // world space, so moving the view never moves the shadow projection.
    vec4 clip = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
    gl_Position = clip.xyww;
}
