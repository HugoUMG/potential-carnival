# Despliegue en Render

El repositorio incluye un `render.yaml` para crear tres recursos:

1. `constructor-hojas-api`: backend FastAPI.
2. `constructor-hojas-web`: frontend estático Vite/React.
3. `constructor-hojas-db`: base PostgreSQL.

Render recomienda que los servicios web escuchen en `0.0.0.0` y usen el puerto `$PORT`; por eso el backend se arranca con:

```bash
uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT
```

## 1. Variables que debes completar

En el servicio `constructor-hojas-api`:

```text
FRONTEND_ORIGINS=https://constructor-hojas-web.onrender.com
JWT_SECRET_KEY=<Render puede generarlo automáticamente desde render.yaml>
DATABASE_URL=<se conecta desde constructor-hojas-db>
SEED_DEMO_USERS=false
```

En el servicio `constructor-hojas-web`:

```text
VITE_API_URL=https://constructor-hojas-api.onrender.com
```

`VITE_API_URL` se aplica en build time; si cambias esta variable, redeploya el frontend.

## 2. Orden de despliegue recomendado

1. Sube el repo a GitHub/GitLab/Bitbucket.
2. En Render crea un Blueprint usando el archivo `render.yaml`.
3. Completa `FRONTEND_ORIGINS` en el backend con la URL final del frontend.
4. Completa `VITE_API_URL` en el frontend con la URL final del backend.
5. Despliega el backend y verifica `https://constructor-hojas-api.onrender.com/health`.
6. Redeploya el frontend para que Vite inyecte `VITE_API_URL`.

## 3. Seguridad incluida

El backend ahora usa:

- JWT Bearer tokens firmados con `JWT_SECRET_KEY`.
- Expiración configurable con `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`.
- Contraseñas hasheadas con PBKDF2-SHA256 al crear usuarios.
- Compatibilidad temporal con passwords heredados en texto plano: si el login es correcto, el hash se actualiza automáticamente.
- Protección por roles:
  - `admin`: administra profesores, estudiantes y evaluaciones.
  - `teacher`: administra sus evaluaciones y estudiantes.
  - `student`: consulta sus evaluaciones/respuestas y envía sus respuestas.

## 4. Usuarios demo

En PostgreSQL los usuarios demo no se crean por defecto. Si necesitas una demo temporal, configura:

```text
SEED_DEMO_USERS=true
DEMO_ADMIN_PASSWORD=una-clave-segura
DEMO_TEACHER_PASSWORD=una-clave-segura
DEMO_STUDENT_PASSWORD=una-clave-segura
```

Después del primer deploy puedes volver a dejar `SEED_DEMO_USERS=false`.

## 5. Checklist antes de producción

- Cambia `FRONTEND_ORIGINS` al dominio real del frontend.
- Cambia `VITE_API_URL` al dominio real del backend.
- Mantén `SEED_DEMO_USERS=false` salvo que sea una demo controlada.
- Usa un `JWT_SECRET_KEY` largo, aleatorio y privado.
- Crea usuarios reales con contraseñas fuertes.
- Activa backups de PostgreSQL en Render según tu plan.
