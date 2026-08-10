const { getDefaultConfig } = require('metro-config');

module.exports = (async () => {
  const defaultConfig = await getDefaultConfig(__dirname);
  return {
    ...defaultConfig,
    projectRoot: __dirname,
    watchFolders: [],
    resolver: {
      ...defaultConfig.resolver,
      assetExts: [...defaultConfig.resolver.assetExts, 'cjs', 'node'],
    },
  };
})();
