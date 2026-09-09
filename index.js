/*
 * ==========================================================================
 * ARCHIVO: index.js
 * QUÉ ES: El punto de entrada de la app en React Native. Registra el
 *         componente raíz (App) para que el sistema lo arranque.
 *         Normalmente no se toca.
 * ==========================================================================
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Registramos App como el componente principal de la aplicación.
AppRegistry.registerComponent(appName, () => App);
