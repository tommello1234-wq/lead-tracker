-- Migration: kanban de produção de criativos
-- Aplique no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS "criativo_kanban" (
    "id" serial PRIMARY KEY NOT NULL,
    "titulo" text NOT NULL,
    "descricao" text,
    "tipo" text DEFAULT 'imagem' NOT NULL,
    "etapa" text DEFAULT 'ideia' NOT NULL,
    "ordem" integer DEFAULT 0 NOT NULL,
    "thumb_url" text,
    "url" text,
    "angulo_id" integer,
    "notas" text,
    "criado_em" timestamp DEFAULT now() NOT NULL,
    "atualizado_em" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "criativo_kanban_angulo_id_angulos_id_fk"
        FOREIGN KEY ("angulo_id") REFERENCES "public"."angulos"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "criativo_kanban_etapa_idx" ON "criativo_kanban" ("etapa");
CREATE INDEX IF NOT EXISTS "criativo_kanban_ordem_idx" ON "criativo_kanban" ("ordem");
