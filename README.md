# Llavero

Gestor de contraseñas web, al estilo de Contraseñas de Apple: guardas una vez y lo tienes en cualquier dispositivo.
Las contraseñas se **cifran en tu navegador** con tu contraseña maestra; Firebase solo guarda datos cifrados que no puede leer.

**Web (v1.0):** contraseña maestra · guardar / editar / borrar · generador · copiar al portapapeles · códigos 2FA (TOTP) · buscador y etiquetas · bloqueo automático a los 5 minutos.
**Extensión (v1.1):** rellena usuario y contraseña en la web en la que estás, copia códigos 2FA, atajo `Alt+Shift+L`.
**Pendiente:** guardar contraseñas nuevas al iniciar sesión desde la extensión, passkeys, cambiar la contraseña maestra, exportar.

La versión aparece en la web (pantalla de entrada y barra lateral) y en la extensión. Cada commit lleva su versión y una etiqueta `vX.Y.Z`.

## Puesta en marcha

1. **Crea un proyecto** en [console.firebase.google.com](https://console.firebase.google.com) (plan gratuito Spark; Google Analytics no hace falta).
2. **Activa el login:** *Compilación › Authentication › Comenzar › Correo electrónico/contraseña* → Habilitar.
3. **Crea la base de datos:** *Compilación › Firestore Database › Crear base de datos*, ubicación en Europa (p. ej. `europe-west1`), en **modo de producción**.
4. **Pon las reglas de seguridad:** en *Firestore › Reglas*, borra lo que haya, pega el contenido de [`firestore.rules`](firestore.rules) y pulsa *Publicar*.
5. **Registra la app web:** *Configuración del proyecto › General › Tus apps › icono `</>`*. Copia `.env.example` como `.env`
   y rellena los cuatro valores (`apiKey`, `authDomain`, `projectId`, `appId`). Son públicos; la seguridad la dan el cifrado y las reglas.
6. Arranca:
   ```bash
   npm install
   npm run dev
   ```

### Publicarla (gratis, en Firebase Hosting)

```bash
npm run build
npx firebase-tools login
npx firebase-tools deploy --project TU-PROJECT-ID
```

Esto sube la web y las reglas de [`firestore.rules`](firestore.rules). Te dará una dirección `https://TU-PROJECT-ID.web.app`.

## Extensión de navegador (Chrome, Edge, Brave)

```bash
npm run build:extension
```

Luego en el navegador: abre `chrome://extensions` (o `edge://extensions`), activa **Modo de desarrollador**,
pulsa **Cargar descomprimida** y elige la carpeta `dist-extension`. Fija el icono de la llave en la barra.

Uso: en la página de login de una web, pulsa el icono (o `Alt+Shift+L`), desbloquea con tu contraseña maestra
y pulsa **Rellenar**. Solo se ofrece rellenar si la web coincide con la guardada en la entrada (o es un subdominio suyo),
y la propia página lo vuelve a comprobar antes de escribir nada, para no caer en webs falsas.

- Permisos mínimos: solo puede tocar la pestaña en la que pulsas el icono, y solo en ese momento (`activeTab`).
- Se queda desbloqueada 15 minutos desde el último uso; se bloquea sola al cerrar el navegador.
- Tras cambiar el código, vuelve a ejecutar `npm run build:extension` y pulsa el botón de recargar de la extensión.

## Cómo funciona la seguridad

```
contraseña maestra + email ──PBKDF2-SHA256 (600.000 rondas)──▶ clave raíz
    clave raíz ──HKDF "auth"──▶ contraseña de login de Firebase   (lo único que ve el servidor)
    clave raíz ──HKDF "wrap"──▶ clave que cifra la clave del llavero
clave del llavero (aleatoria, AES-256-GCM) ──▶ cifra cada entrada entera (nombre, web, usuario, contraseña, 2FA, notas, etiquetas)
```

- El servidor nunca recibe la contraseña maestra ni ninguna clave que permita descifrar.
- Cada entrada está ligada a su id, así que no se puede mover un cifrado de una entrada a otra.
- Las reglas de Firestore hacen que cada usuario solo pueda leer y tocar lo suyo, y que la clave del llavero no se pueda sobrescribir.
- La clave se guarda solo en memoria: al recargar la página o tras 5 minutos sin actividad, el llavero se bloquea.
- **Si olvidas la contraseña maestra no hay forma de recuperar los datos.** No uses "restablecer contraseña" de Firebase:
  cambiaría el login pero no podría descifrar nada.
- El email forma parte del cifrado: por ahora no se puede cambiar el email de la cuenta.
- Si editas la misma entrada a la vez en dos dispositivos, gana el último que guarde.

## Desarrollo

- `npm test` — pruebas de cifrado, 2FA (vectores oficiales del RFC 6238), generador y enlaces.
- `npm run build` — comprueba tipos y genera `dist/`.
- Probar sin tocar tu proyecto real (necesita Java 21): `npx firebase-tools emulators:start --project demo-llavero`
  y arrancar la web con `VITE_FIREBASE_EMULATOR=true` y valores de relleno en `.env` (`VITE_FIREBASE_PROJECT_ID=demo-llavero`).
