module.exports = {
  appId: 'local.ezenvironment.studio',
  productName: 'EZ Environment',
  copyright: 'EZ Environment contributors; EZ-Tree © Daniel Greenheck (MIT)',
  directories: { output: 'release', buildResources: 'desktop/resources' },
  files: ['dist/**/*', 'desktop/main.cjs', 'desktop/security.cjs', 'LICENSE', 'package.json'],
  extraMetadata: {
    name: 'ez-environment-desktop',
    description: 'Local procedural trees, plants, rocks, and environment authoring.',
    main: 'desktop/main.cjs',
  },
  asar: true,
  npmRebuild: false,
  win: {
    target: [{ target: 'portable', arch: ['x64'] }],
    executableName: 'EZ Environment',
    icon: 'src/app/public/android-chrome-512x512.png',
    signExecutable: false,
    requestedExecutionLevel: 'asInvoker',
  },
  portable: {
    artifactName: 'EZ-Environment-${version}-Portable.exe',
    requestExecutionLevel: 'user',
  },
  publish: null,
};
