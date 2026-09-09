/*
 * ==========================================================================
 * ARCHIVO: App.js
 * QUÉ ES: Componente raíz. Hace de "navegador" simple entre pantallas y
 *         arranca Logger + ChatManager al conocer el perfil.
 * --------------------------------------------------------------------------
 * DEPENDE DE: Storage, Logger, ChatManager y las 4 pantallas.
 *
 * NAVEGACIÓN (estado 'screen'):
 *   'loading' | 'username' | 'chats' | 'chat' | 'settings'
 *
 * ARRANQUE:
 *   1) Cargamos el estado de logs y arrancamos el Logger con él.
 *   2) Miramos si hay perfil:
 *        hay  -> ChatManager.init(userId) -> 'chats'
 *        no   -> 'username'
 * ==========================================================================
 */

import React, { useState, useEffect } from 'react';
import { View } from 'react-native';

import Storage from './src/services/Storage';
import Logger from './src/services/Logger';
import ChatManager from './src/state/ChatManager';

import UsernameScreen from './src/screens/UsernameScreen';
import ChatsListScreen from './src/screens/ChatsListScreen';
import ChatScreen from './src/screens/ChatScreen';
import SettingsScreen from './src/screens/SettingsScreen';

export default function App() {
  const [screen, setScreen] = useState('loading');
  const [peerId, setPeerId] = useState(null);

  useEffect(() => {
    (async () => {
      // 1) Arrancamos el Logger con la preferencia guardada (por defecto ON).
      const logsOn = await Storage.getLogsEnabled();
      Logger.init(logsOn);

      // 2) ¿Hay perfil ya guardado?
      const profile = await Storage.getProfile();
      if (profile) {
        ChatManager.init(profile.userId, profile.username);
        setScreen('chats');
      } else {
        setScreen('username');
      }
    })();
  }, []);

  // Se llama cuando UsernameScreen crea el perfil.
  function onProfileReady(profile) {
    ChatManager.init(profile.userId, profile.username);
    setScreen('chats');
  }

  function openChat(id) {
    setPeerId(id);
    setScreen('chat');
  }

  // --- Render según pantalla ---

  if (screen === 'loading') {
    return <View style={{ flex: 1, backgroundColor: '#ECE5DD' }} />;
  }
  if (screen === 'username') {
    return <UsernameScreen onDone={onProfileReady} />;
  }
  if (screen === 'chats') {
    return (
      <ChatsListScreen
        onOpenChat={openChat}
        onOpenSettings={() => setScreen('settings')}
      />
    );
  }
  if (screen === 'chat') {
    return <ChatScreen peerId={peerId} onBack={() => setScreen('chats')} />;
  }
  if (screen === 'settings') {
    return <SettingsScreen onBack={() => setScreen('chats')} />;
  }
  return null;
}
