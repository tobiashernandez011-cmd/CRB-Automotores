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

## 4. Activar el historial de presupuestos

1. En Supabase, abrí **SQL Editor → New query**.
2. Copiá y ejecutá el contenido de [`supabase/schema.sql`](./supabase/schema.sql). Esto crea la tabla `public.quotes` y sus políticas RLS.
3. Volvé a la aplicación e iniciá sesión. Guardá un presupuesto con **Guardar presupuesto**; aparecerá en **Historial**. Usá la búsqueda por cliente y elegí un resultado para ver la hoja completa y los datos.

El personal autenticado puede consultar todos los presupuestos y crear registros bajo su propia cuenta. Los presupuestos guardados no tienen opciones para modificar o eliminar desde la aplicación.

## 5. Configurar Vercel

En el proyecto de Vercel, abrí **Settings → Environment Variables** y cargá:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Aplicá las variables a los entornos que uses y volvé a desplegar el proyecto. La clave pública puede estar en el cliente; nunca agregues `service_role` ni claves secretas con prefijo `NEXT_PUBLIC_`.

## PDF y WhatsApp

- **Descargar PDF** genera y descarga una hoja A4 con el formato del presupuesto.
- **Abrir WhatsApp** abre el chat del número ingresado, sin texto prearmado. Descargá primero el PDF y adjuntalo manualmente desde ese chat.
- El navegador no permite que esta página adjunte el archivo automáticamente a un chat `wa.me`.

Para automatizar un envío desde la cuenta de WhatsApp Business sin usar el menú de compartir hace falta implementar la WhatsApp Business Platform (Cloud API), configurar credenciales seguras en servidor y cumplir sus reglas de consentimiento y plantillas. Una clave `wa.me` o una clave de Supabase no habilitan ese envío.
