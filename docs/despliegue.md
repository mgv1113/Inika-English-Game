# Despliegue en el VPS

Requisitos: Docker con el plugin compose, y los puertos 80 y 443 abiertos.

1. En el DNS del dominio, crear un registro **A** para el subdominio (por ejemplo `english-game.inikatech.com`; en Cloudflare con la nube gris, "DNS only") apuntando a la IP del VPS.
2. En el VPS:

   ```bash
   git clone https://github.com/mgv1113/Inika-English-Game.git
   cd Inika-English-Game
   cp .env.example .env
   # editar .env: DOMAIN y una contraseña segura en POSTGRES_PASSWORD
   docker compose up -d --build
   ```

3. Comprobar: `curl https://<DOMAIN>/api/health` debe responder `"db":"up","cache":"up"`.

Caddy obtiene y renueva el certificado HTTPS de Let's Encrypt automáticamente.

## Actualizar

```bash
git pull
docker compose up -d --build
```

Las migraciones de la base de datos se aplican solas cuando arranca el servidor (`docker compose logs server` muestra "migraciones aplicadas").

## Respaldo de la base de datos

```bash
docker compose exec db pg_dump -U inika inika > respaldo-$(date +%F).sql
```

## VPS con nginx-proxy (puertos 80/443 ya ocupados)

Si el VPS ya tiene `nginxproxy/nginx-proxy` y `acme-companion` sirviendo otros sitios, el juego no publica puertos: se une a la red de nginx-proxy y acme-companion le saca el certificado.

1. Averiguar la red de nginx-proxy:

   ```bash
   docker inspect nginx-proxy -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
   ```

2. En `.env`, descomentar y completar:

   ```
   COMPOSE_FILE=docker-compose.yml:docker-compose.nginx-proxy.yml
   PROXY_NETWORK=<la red del paso 1>
   ```

3. `docker compose up -d --build` como siempre. El certificado puede tardar uno o dos minutos la primera vez (`docker logs acme-companion` muestra el avance).

## Entrar con Google y Facebook

Los botones "Continuar con Google" y "Continuar con Facebook" solo aparecen si sus credenciales están en `.env`. Las credenciales se crean en la consola de cada proveedor con estas URL de redirección exactas (cambiando el dominio si usas otro):

- Google: `https://english-game.inikatech.com/api/auth/google/callback`
- Facebook: `https://english-game.inikatech.com/api/auth/facebook/callback`

La política de privacidad y las instrucciones para borrar datos, que piden ambos, están en `https://english-game.inikatech.com/privacidad.html` (sección `#borrar`).

Después de completar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_APP_ID` y `FACEBOOK_APP_SECRET` en `.env`:

```bash
docker compose up -d server
docker compose logs server | grep "inicio de sesión externo"
```

El registro muestra qué proveedores quedaron activos. Si Google y Facebook traen el mismo correo, el juego las une en una sola cuenta. Si el correo ya está registrado con contraseña, no las une solo: pide entrar con la contraseña.
