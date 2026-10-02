# Despliegue en el VPS

Requisitos: Docker con el plugin compose, y los puertos 80 y 443 abiertos.

1. En el DNS del dominio, crear un registro **A** para el subdominio (por ejemplo `english.inikatech.com`; en Cloudflare con la nube gris, "DNS only") apuntando a la IP del VPS.
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

## Respaldo de la base de datos

```bash
docker compose exec db pg_dump -U inika inika > respaldo-$(date +%F).sql
```

Si el VPS ya usa los puertos 80/443 para otro sitio, hay que poner el juego detrás del proxy existente en lugar de exponer Caddy directamente; avisar y se ajusta.
