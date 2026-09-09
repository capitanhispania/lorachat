/*
 * ==========================================================================
 * ARCHIVO: src/screens/UsernameScreen.js
 * QUÉ ES: Primera pantalla. Solo aparece si aún no hay perfil guardado.
 *         Pide un nombre, genera un USER_ID aleatorio de 32 bits y guarda
 *         el perfil. Luego avisa a App.js para pasar a la lista de chats.
 * --------------------------------------------------------------------------
 * DEPENDE DE: Storage (para guardar el perfil).
 * RECIBE POR PROPS:
 *   onDone(profile) -> callback que App.js pasa; se llama al terminar.
 *
 * FLUJO:
 *   usuario escribe nombre -> pulsa "Entrar" -> guardaPerfil() ->
 *   genera userId -> Storage.setProfile -> onDone(profile)
 * ==========================================================================
 */

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Storage from '../services/Storage';

// Componente de pantalla. 'onDone' viene de App.js.
export default function UsernameScreen({ onDone }) {
  // Estado local: lo que el usuario va escribiendo en el campo.
  const [name, setName] = useState('');

  // guardaPerfil(): genera identidad y la persiste.
  async function guardaPerfil() {
    // Quitamos espacios y evitamos nombres vacíos.
    const clean = name.trim();
    if (clean.length === 0) return;

    // Generamos un USER_ID aleatorio de 32 bits (0 .. 4.294.967.295).
    const userId = Math.floor(Math.random() * 0x100000000);

    // Montamos el perfil y lo guardamos.
    const profile = { userId, username: clean };
    await Storage.setProfile(profile);

    // Avisamos a App.js de que ya hay perfil.
    onDone(profile);
  }

  return (
    <View style={styles.container}>
      {/* Título de bienvenida */}
      <Text style={styles.title}>LoRa Chat</Text>
      <Text style={styles.subtitle}>Elige un nombre de usuario</Text>

      {/* Campo de texto para el nombre */}
      <TextInput
        style={styles.input}
        placeholder="Tu nombre"
        value={name}
        onChangeText={setName}
        maxLength={20}
      />

      {/* Botón para confirmar */}
      <TouchableOpacity style={styles.button} onPress={guardaPerfil}>
        <Text style={styles.buttonText}>Entrar</Text>
      </TouchableOpacity>
    </View>
  );
}

// Estilos de la pantalla.
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center', // centrado vertical
    padding: 24,
    backgroundColor: '#ECE5DD', // fondo tipo WhatsApp
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#075E54',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    color: '#333',
    marginBottom: 24,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#128C7E',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
