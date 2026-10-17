# Configurar el acceso con Supabase

## 1. Crear el proyecto

1. Creá un proyecto en [Supabase](https://supabase.com/).
2. En **Project Settings → API**, copiá la **Project URL** y la clave **Publishable** (`sb_publishable_...`). En proyectos antiguos, se puede usar la clave `anon` pública.
3. No uses ni publiques la clave `service_role` o una clave `secret` en la aplicación.

## 2. Configurar el entorno local

1. Copiá `.env.example` a `.env.local`.
2. Reemplazá los valores de ejemplo con la URL y la clave pública del proyecto.
3. Reiniciá el servidor de desarrollo (`npm run dev`) para que Next.js cargue las variables.

## 3. Crear las cuentas del personal

En Supabase, abrí **Authentication → Users → Add user → Create new user** y creá una cuenta por integrante autorizado. El formulario de la aplicación solo permite iniciar sesión; no ofrece registro público. Compartí las credenciales por un canal privado y usá una contraseña única.

En **Authentication → URL Configuration**, agregá `http://localhost:3000` como URL local. Al desplegar, configurá como Site URL la dirección de producción de Vercel y agregala también a Redirect URLs.

## 4. Crear el historial protegido

En Supabase, abrí **SQL Editor**, pegá el contenido de [`supabase/schema.sql`](./supabase/schema.sql) y ejecutalo. El script agrega los campos necesarios a `public.quotes` si ya existe, crea el bucket privado `quote-pdfs` y aplica políticas RLS. Si ya habías configurado el historial, volvé a ejecutar el script actualizado para habilitar la edición y la nueva sección de mecánica. El historial es compartido entre las cuentas autorizadas del taller; cada persona solo puede crear registros con su propio ID.

Después, autorizá explícitamente las cuentas del personal. Primero consultá sus IDs en **SQL Editor**:

```sql
select id, email from auth.users;
```

Agregá solo los UUID de las personas autorizadas:

```sql
insert into public.staff_members (user_id)
values ('UUID-DEL-USUARIO')
on conflict (user_id) do nothing;
```

Sin una fila en `staff_members`, una cuenta no puede consultar ni guardar presupuestos, aunque haya podido iniciar sesión.

Los PDFs nuevos se guardan en el bucket antes de iniciar la descarga. Si no se pueden guardar el archivo y sus datos, la descarga se cancela y la aplicación muestra el error. El presupuesto permite detallar trabajos de **Reparar**, **Mecánica** y **Reemplazar**; la frase “VER MÁS AL DESARMAR” se resalta en negrita donde aparezca. Desde **Historial** se puede buscar por cliente y rango de fechas, consultar los datos, abrir, editar y eliminar presupuestos. Al editar y guardar, se actualizan los datos del mismo registro y se reemplaza el PDF archivado; el archivo anterior se conserva hasta confirmar la actualización. Todos los miembros autorizados del taller pueden editar y eliminar presupuestos. Los registros anteriores que no tengan `pdf_path` siguen mostrando sus datos y pueden editarse para generar su primer PDF actualizado.

## 5. Configurar Vercel

En el proyecto de Vercel, abrí **Settings → Environment Variables** y cargá:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Aplicá las variables a los entornos que uses y volvé a desplegar el proyecto. La clave pública puede estar en el cliente; nunca agregues `service_role` ni claves secretas con prefijo `NEXT_PUBLIC_`.

## 6. Seguridad operativa

- En **Authentication → Settings**, desactivá el registro público y habilitá la confirmación de correo para las cuentas creadas por el taller. RLS también exige pertenecer a `staff_members`.
- Configurá límites de intentos en **Authentication → Rate Limits** y CAPTCHA en **Authentication → Bot and Abuse Protection** (por ejemplo, Cloudflare Turnstile). Estas opciones requieren configurarse en el panel de Supabase.
- Usá una contraseña única por persona y revocá el usuario cuando ya no deba tener acceso. Supabase Auth gestiona el hash de las contraseñas; la aplicación no las almacena.
- La URL y la clave **Publishable** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) son valores de cliente, no contraseñas. La seguridad de los datos depende de RLS. Nunca uses una clave `service_role`/`secret` en el navegador ni la guardes en Git.
- `.env.local` está excluido por `.gitignore`. Guardá las variables de producción solo en la configuración privada de Vercel y rotá cualquier secreto que haya sido publicado.
- El acceso al historial y los PDFs privados requiere una sesión autenticada. Los permisos de RLS de la tabla y del bucket son la barrera de acceso a los datos, incluso si alguien modifica las solicitudes desde el navegador.
- Los datos se envían mediante HTTPS; en producción las cookies de Supabase se configuran como `Secure` y `SameSite=Lax`. La sesión que administra el SDK en el navegador no es `HttpOnly`: el cliente de Supabase necesita leerla para renovar y cerrar la sesión. Las contraseñas no se guardan en la app; Supabase Auth las almacena con hash. Supabase administra el cifrado de almacenamiento en reposo.
- La app impone límites de longitud, valida los datos antes de guardar, representa el contenido como texto (sin insertarlo como HTML) y usa las consultas parametrizadas del cliente Supabase. La base también valida los campos y `created_by`.
- El PDF conserva el título y las bandas dentro de la imagen A4 y agrega el logo como imagen independiente en coordenadas A4 fijas para conservar su posición en lectores móviles. La impresión directa desde el navegador también restaura el diseño A4 en vez de usar el escalado de la vista móvil.
- Next.js añade una CSP con nonce, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` y HSTS. Vercel debe servir el sitio por HTTPS.
- Ejecutá `npm audit` periódicamente. Las vulnerabilidades de dependencias de desarrollo deben revisarse y actualizarse sin forzar cambios mayores de Tailwind o Next.js.

## PDF, WhatsApp y correo

- **Descargar PDF** genera y descarga el presupuesto en una o más hojas A4 según la cantidad de trabajos; cada hoja repite el membrete, el logo y el pie de página, y los importes aparecen al final.
- **Abrir WhatsApp** abre directamente el chat del número ingresado. Para adjuntar el PDF, primero se descarga con **Descargar PDF** y luego se adjunta desde el chat.
- **Abrir Gmail** abre un borrador web dirigido a la dirección ingresada. Descargá el PDF por separado y adjuntalo manualmente antes de enviarlo.
- Los enlaces no pueden adjuntar archivos automáticamente ni enviar el correo por su cuenta.
- La aplicación nunca envía el correo o mensaje por su cuenta.

Para automatizar un envío desde la cuenta de WhatsApp Business sin usar el menú de compartir hace falta implementar la WhatsApp Business Platform (Cloud API), configurar credenciales seguras en servidor y cumplir sus reglas de consentimiento y plantillas. Una clave `wa.me` o una clave de Supabase no habilitan ese envío.
