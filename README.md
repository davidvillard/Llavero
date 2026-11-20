# Llavero

Gestor de contraseñas web, al estilo de Contraseñas de Apple: guardas una vez y lo tienes en cualquier dispositivo.
Las contraseñas se **cifran en tu navegador** con tu contraseña maestra; Firebase solo guarda datos cifrados que no puede leer.

**Web (v1.0):** contraseña maestra · guardar / editar / borrar · generador · copiar al portapapeles · códigos 2FA (TOTP) · buscador y etiquetas · bloqueo automático a los 5 minutos.
**Extensión (v1.1–1.2):** rellena usuario y contraseña, ofrece guardar o actualizar al iniciar sesión, sugiere contraseñas seguras al registrarte, copia códigos 2FA, atajo `Alt+Shift+L`.
**Ajustes (v1.3):** cambiar la contraseña maestra · importar CSV de Chrome, Apple, Bitwarden, 1Password, LastPass o Firefox · exportar en CSV o en una copia cifrada.
**Pendiente:** passkeys.

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

### Publicarla (gratis, en Vercel)

1. En [vercel.com/new](https://vercel.com/new), importa este repositorio de GitHub. Vercel detecta Vite; la configuración
   (compilación, carpeta `dist` y cabeceras de seguridad) ya está en [`vercel.json`](vercel.json).
2. Antes de pulsar *Deploy*, en *Environment Variables* añade las cuatro `VITE_FIREBASE_*` de tu `.env`.
   Si las añades o cambias después, vuelve a desplegar: se incrustan al compilar.
3. En Firebase, *Authentication › Settings › Authorized domains*, añade tu dominio de Vercel (p. ej. `llavero.vercel.app`).

Desde entonces, cada `git push` a `main` publica la web sola. Las reglas de Firestore no viajan con la web:
si cambias [`firestore.rules`](firestore.rules), pégalas en la consola (paso 4) o súbelas con
`npx firebase-tools deploy --only firestore:rules --project TU-PROJECT-ID`.

### Opcional: limitar la `apiKey` a lo que usa el Llavero

En [Google Cloud › Credenciales](https://console.cloud.google.com/apis/credentials), abre la clave *Browser key* del proyecto
y en *Restricciones de API* deja solo: **Identity Toolkit API**, **Token Service API**, **Cloud Firestore API** y
**Cloud Datastore API**. No pongas *Restricciones de aplicaciones › Sitios web*: Google no documenta que admita
extensiones (`chrome-extension://`) y la extensión podría dejar de funcionar. La protección de verdad sigue siendo el cifrado y las reglas.

## Extensión de navegador (Chrome, Edge, Brave)

```bash
npm run build:extension
```

Luego en el navegador: abre `chrome://extensions` (o `edge://extensions`), activa **Modo de desarrollador**,
pulsa **Cargar descomprimida** y elige la carpeta `dist-extension`. Fija el icono de la llave en la barra.

Uso:
- **Rellenar:** en la página de login, pulsa el icono (o `Alt+Shift+L`) y pulsa **Rellenar**. Solo se ofrece si la web
  coincide con la guardada (o es un subdominio suyo), y la propia página lo vuelve a comprobar antes de escribir nada,
  para no caer en webs falsas.
- **Guardar al iniciar sesión:** cuando entras en una web escribiendo tú la contraseña, Llavero se abre solo y te
  pregunta si guardarla (o actualizarla, si ya tenías otra para ese usuario). *Ahora no* / *Nunca en esta web*.
  Si tu navegador no puede abrirlo solo, verás un **1** en el icono.
- **Sugerir contraseña segura:** en un formulario de registro o de cambio de contraseña, abre Llavero y pulsa
  *Sugerir contraseña segura*: la escribe en los campos y la guarda al momento, para que no se pierda.

Privacidad y permisos:
- Para detectar los inicios de sesión, la extensión necesita estar en todas las webs (Chrome lo avisa al instalarla como
  "leer y cambiar tus datos en todos los sitios web"). Solo mira los formularios cuando los envías, y lo detectado se
  queda en la memoria del navegador hasta que lo guardas o lo descartas (máximo 5 minutos). Nunca sale de tu equipo sin cifrar.
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
- Las reglas de Firestore hacen que cada usuario solo pueda leer y tocar lo suyo, y que la clave del llavero no se pueda borrar
  ni sobrescribir de golpe.
- **Cambiar la contraseña maestra** no vuelve a cifrar las entradas: la clave del llavero es la misma y solo cambian su envoltorio
  y la contraseña de login. Se hace en tres pasos (guardar la nueva junto a la actual, cambiar el login, dejar solo la nueva),
  así que si se corta a medias nunca te quedas fuera: entras con la que tenga el login y ese inicio de sesión termina el cambio.
- **Exportar** pide la contraseña maestra. La copia cifrada usa su propia contraseña (PBKDF2 con sal aleatoria + AES-256-GCM)
  y se puede importar sin la cuenta. El CSV va sin cifrar: bórralo en cuanto lo uses.
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
