// Configuración de Metro (el empaquetador de RN). Por defecto, sin cambios.
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const config = {};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
