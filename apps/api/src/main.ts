import "./env";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import express from "express";
import { AppModule } from "./app.module";
import { RedisIoAdapter } from "./realtime/redis-io.adapter";
import { UPLOADS_DIR } from "./uploads/storage.provider";

async function bootstrap() {
  // rawBody: true expone req.rawBody para verificar la firma de los webhooks de pago.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks(); // cierra pools de Postgres limpiamente (D1 auditoría)
  // CORS: en dev refleja cualquier origen (localhost/127.0.0.1/IP de red) para no
  // bloquear la web de compra según cómo se abra. En prod, restringir a WEB_ORIGIN
  // (dominios reales de las tiendas).
  app.enableCors({
    origin: process.env.WEB_ORIGIN ? process.env.WEB_ORIGIN.split(",") : true,
  });

  // Imágenes subidas (dev: disco local; en prod las serviría un CDN/bucket). Públicas.
  // nosniff: el navegador no reinterpreta nunca un fichero como otra cosa (p.ej. HTML).
  app.use(
    "/uploads",
    express.static(UPLOADS_DIR, {
      index: false,
      dotfiles: "deny",
      maxAge: "30d",
      immutable: true, // nombres únicos: un fichero nunca cambia
      setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
    }),
  );

  // WebSocket con adaptador Redis (escalado horizontal). Si Redis no responde, se
  // degrada a modo in-process: el tiempo real sigue funcionando en una sola réplica.
  const redisAdapter = new RedisIoAdapter(app);
  try {
    await redisAdapter.connectToRedis();
    app.useWebSocketAdapter(redisAdapter);
    Logger.log("WebSocket: adaptador Redis activo (multi-instancia)", "Bootstrap");
  } catch (e) {
    Logger.warn(
      `WebSocket: Redis no disponible (${e instanceof Error ? e.message : e}); modo in-process`,
      "Bootstrap",
    );
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API escuchando en http://localhost:${port}`);
}

void bootstrap();
