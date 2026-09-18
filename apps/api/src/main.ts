import "reflect-metadata";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ZodExceptionFilter } from "./zod-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalFilters(new ZodExceptionFilter());
  app.enableCors({ origin: process.env.PUBLIC_WEB_URL ?? "http://localhost:5173", credentials: true });
  await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
  console.info(`Video to Doc API listening on ${process.env.PORT ?? 3000}`);
}

void bootstrap();
