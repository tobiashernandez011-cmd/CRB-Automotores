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

## 4. Configurar Vercel

En el proyecto de Vercel, abrí **Settings → Environment Variables** y cargá:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Aplicá las variables a los entornos que uses y volvé a desplegar el proyecto. La clave pública puede estar en el cliente; nunca agregues `service_role` ni claves secretas con prefijo `NEXT_PUBLIC_`.

## PDF, WhatsApp y correo

- **Descargar PDF** genera y descarga una hoja A4 con el formato del presupuesto.
- **Abrir WhatsApp** abre el chat del número ingresado, sin texto prearmado. Descargá primero el PDF y adjuntalo manualmente desde ese chat.
- El navegador no permite que esta página adjunte el archivo automáticamente a un chat `wa.me`.
- **Abrir Gmail** abre un borrador web dirigido a la dirección cargada en el campo del cliente. Descargá primero el PDF y adjuntalo manualmente antes de enviarlo; la aplicación no manda el correo automáticamente.
- Por seguridad, el navegador no permite que la aplicación adjunte el PDF automáticamente a Gmail.

La aplicación no guarda presupuestos. Si se ejecutó anteriormente el SQL que creaba `public.quotes`, esa tabla queda sin uso; la aplicación ya no consulta ni escribe en ella.

Para automatizar un envío desde la cuenta de WhatsApp Business sin usar el menú de compartir hace falta implementar la WhatsApp Business Platform (Cloud API), configurar credenciales seguras en servidor y cumplir sus reglas de consentimiento y plantillas. Una clave `wa.me` o una clave de Supabase no habilitan ese envío.
