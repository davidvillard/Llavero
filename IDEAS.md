# Ideas de proyectos

Lista viva de ideas. Cada una tiene: qué es, funciones, y notas a tener en cuenta.

| # | Idea | Estado |
|---|------|--------|
| 1 | Gestor de contraseñas web | ✅ v1 funcionando en local — ver README.md |
| 2 | Galería de cosas interesantes | 💡 Idea |

---

## 1. Gestor de contraseñas web

**Qué es:** Algo parecido a las Contraseñas de iPhone (Llavero de iCloud), pero accesible desde cualquier navegador.

**Funciones:**
- Guardar contraseñas (sitio, usuario, contraseña, notas)
- Generar contraseñas seguras (longitud, símbolos, números…)
- Guardar códigos de verificación 2FA (TOTP, los de 6 dígitos que cambian cada 30 s)
- Guardar llaves de acceso (passkeys)
- Rellenar contraseñas automáticamente en otras webs
- Buscador y organización por carpetas o etiquetas

**Notas importantes:**
- **Cifrado en el navegador:** las contraseñas deben cifrarse en el dispositivo con una contraseña maestra antes de enviarse al servidor. El servidor nunca debe poder leerlas.
- **Autorrellenar en otras webs:** una web normal no puede rellenar formularios de otras webs. Para eso hace falta una **extensión de navegador** además de la web.
- **Passkeys:** guardar passkeys de otras webs es más complejo que guardar contraseñas; se podría dejar para una segunda fase.
- Para empezar se puede hacer una primera versión solo con: contraseña maestra + guardar + generar + copiar al portapapeles.

---

## 2. Galería de cosas interesantes

**Qué es:** Un sitio donde subir fotos de cosas que te gustan (ej. una chaqueta) con una nota de por qué la guardaste.

**Funciones:**
- Subir imagen + descripción (por qué la guardé)
- Fecha y hora guardadas automáticamente
- Ver todo organizado (por fecha, y opcionalmente por categoría/etiqueta)
- Buscar por texto en la descripción
- Eliminar lo que ya no sirve

**Ideas extra (opcionales):**
- Categorías o etiquetas (ropa, tecnología, casa…)
- Enlace a la tienda o web donde lo viste
- Marcar como "conseguido" en vez de borrar

**Notas importantes:**
- Pedir confirmación antes de eliminar (o tener papelera) para no borrar por error.
- Reducir el tamaño de las imágenes al subirlas para que no ocupen demasiado.

---

## 3. (Próximamente)

_Añadir nuevas ideas aquí._
