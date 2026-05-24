import { useState, useRef, type DragEvent, type ChangeEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Lightbulb, Hammer, Beaker, X, ExternalLink, GripVertical, Upload, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Tipos espelhados do shared/db schema (não importamos pra evitar dep no client)
type Etapa = "ideia" | "produzido" | "testado" | "recusado";
type Tipo = "imagem" | "video" | "carrossel";

type CriativoKanban = {
  id: number;
  titulo: string;
  descricao: string | null;
  tipo: Tipo;
  etapa: Etapa;
  ordem: number;
  thumbUrl: string | null;
  url: string | null;
  anguloId: number | null;
  notas: string | null;
  criadoEm: string;
  atualizadoEm: string;
};

const COLUNAS: { etapa: Etapa; titulo: string; icon: typeof Lightbulb; cor: string; bg: string }[] = [
  { etapa: "ideia", titulo: "Ideias", icon: Lightbulb, cor: "text-amber-400 border-amber-500/30", bg: "bg-amber-500/5" },
  { etapa: "produzido", titulo: "Produzidos", icon: Hammer, cor: "text-blue-400 border-blue-500/30", bg: "bg-blue-500/5" },
  { etapa: "testado", titulo: "Testados", icon: Beaker, cor: "text-emerald-400 border-emerald-500/30", bg: "bg-emerald-500/5" },
  { etapa: "recusado", titulo: "Recusados", icon: X, cor: "text-rose-400 border-rose-500/30", bg: "bg-rose-500/5" },
];

const TIPO_LABEL: Record<Tipo, string> = {
  imagem: "🖼️ Imagem",
  video: "🎬 Vídeo",
  carrossel: "🎠 Carrossel",
};

export function CriativosPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CriativoKanban | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultEtapa, setDefaultEtapa] = useState<Etapa>("ideia");
  const [dragOver, setDragOver] = useState<Etapa | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["criativos-kanban"],
    queryFn: () => api.get<CriativoKanban[]>("/api/criativos-kanban"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CriativoKanban> }) =>
      api.patch<CriativoKanban>(`/api/criativos-kanban/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["criativos-kanban"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/criativos-kanban/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["criativos-kanban"] }),
  });

  function openNew(etapa: Etapa) {
    setDefaultEtapa(etapa);
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(item: CriativoKanban) {
    setEditing(item);
    setDialogOpen(true);
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>, id: number) {
    e.dataTransfer.setData("text/plain", String(id));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, etapa: Etapa) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(etapa);
  }

  function handleDragLeave() {
    setDragOver(null);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, etapa: Etapa) {
    e.preventDefault();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (!Number.isFinite(id)) return;
    const item = items.find((it) => it.id === id);
    if (!item || item.etapa === etapa) return;
    updateMutation.mutate({ id, data: { etapa } });
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-sm text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-[1600px]">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">Criativos</h1>
          <p className="text-sm text-muted-foreground">
            Pipeline de produção · {items.length} {items.length === 1 ? "criativo" : "criativos"} · arraste pra mover entre colunas
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {COLUNAS.map((col) => {
          const Icon = col.icon;
          const colItems = items.filter((it) => it.etapa === col.etapa);
          const isDragOver = dragOver === col.etapa;
          return (
            <div
              key={col.etapa}
              onDragOver={(e) => handleDragOver(e, col.etapa)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.etapa)}
              className={`flex flex-col rounded-lg border ${col.cor} ${col.bg} transition-all ${
                isDragOver ? "ring-2 ring-offset-2 ring-offset-background ring-current" : ""
              }`}
            >
              {/* Header da coluna */}
              <div className="flex items-center justify-between p-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${col.cor.split(" ")[0]}`} />
                  <h2 className="font-semibold text-sm">{col.titulo}</h2>
                  <span className="text-xs text-muted-foreground">{colItems.length}</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => openNew(col.etapa)}
                  title="Novo criativo"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {/* Cards */}
              <div className="flex-1 p-2 space-y-2 min-h-[400px]">
                {colItems.map((item) => (
                  <Card
                    key={item.id}
                    item={item}
                    onEdit={() => openEdit(item)}
                    onDelete={() => {
                      if (confirm(`Excluir "${item.titulo}"?`)) deleteMutation.mutate(item.id);
                    }}
                    onDragStart={(e) => handleDragStart(e, item.id)}
                  />
                ))}
                {colItems.length === 0 && (
                  <div className="text-xs text-muted-foreground/50 text-center py-8">
                    Vazio
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <CriativoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        defaultEtapa={defaultEtapa}
      />
    </div>
  );
}

function Card({
  item,
  onEdit,
  onDelete,
  onDragStart,
}: {
  item: CriativoKanban;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="group relative bg-card border border-border rounded-md p-3 cursor-move hover:border-foreground/30 hover:shadow-md transition-all"
    >
      <div className="flex items-start gap-2 mb-2">
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground mb-1">{TIPO_LABEL[item.tipo]}</div>
          <div className="text-sm font-medium text-foreground line-clamp-2">{item.titulo}</div>
        </div>
      </div>

      {item.thumbUrl && (
        <div className="aspect-video bg-muted rounded mb-2 overflow-hidden">
          <img src={item.thumbUrl} alt={item.titulo} className="w-full h-full object-cover" />
        </div>
      )}

      {item.descricao && (
        <p className="text-xs text-muted-foreground line-clamp-3 mb-2">{item.descricao}</p>
      )}

      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline mb-2"
        >
          <ExternalLink className="w-3 h-3" />
          Abrir mídia
        </a>
      )}

      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onEdit} title="Editar">
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-rose-400 hover:text-rose-300"
          onClick={onDelete}
          title="Excluir"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function UploadField({
  url,
  onUrlChange,
  onTypeDetected,
}: {
  url: string;
  onUrlChange: (u: string) => void;
  onTypeDetected: (contentType: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > 50 * 1024 * 1024) {
      setError(`Arquivo > 50MB (${(file.size / 1024 / 1024).toFixed(1)}MB). Reduza antes de enviar.`);
      return;
    }
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setError(`Tipo não suportado: ${file.type || "desconhecido"}`);
      return;
    }
    setUploading(true);
    setProgress(`Preparando upload de ${(file.size / 1024 / 1024).toFixed(1)}MB...`);
    try {
      // 1. Pede URL assinada pro backend (passa só metadata, não o arquivo)
      const urlRes = await fetch("/api/criativos-kanban/upload-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });
      const urlData = (await urlRes.json()) as {
        signedUrl?: string;
        publicUrl?: string;
        error?: string;
      };
      if (!urlRes.ok || !urlData.signedUrl || !urlData.publicUrl) {
        throw new Error(urlData.error || `HTTP ${urlRes.status}`);
      }

      // 2. Upload DIRETO pro Supabase Storage (evita limite 4.5MB do Vercel)
      setProgress(`Enviando ${(file.size / 1024 / 1024).toFixed(1)}MB...`);
      const uploadRes = await fetch(urlData.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) {
        throw new Error(`Upload falhou: HTTP ${uploadRes.status}`);
      }

      // 3. Usa a publicUrl
      onUrlChange(urlData.publicUrl);
      if (file.type) onTypeDetected(file.type);
      setProgress(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no upload");
      setProgress(null);
    } finally {
      setUploading(false);
    }
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // permite re-upload do mesmo arquivo
    e.target.value = "";
  }

  const isVideo = url && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
  const isImage = url && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);

  return (
    <div>
      <Label>Arquivo do criativo</Label>
      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        onChange={onChange}
        className="hidden"
      />
      {!url && (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="w-full border-2 border-dashed border-border hover:border-foreground/40 rounded-md p-6 flex flex-col items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{progress || "Enviando..."}</span>
            </>
          ) : (
            <>
              <Upload className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm font-medium">Clique pra enviar imagem ou vídeo</span>
              <span className="text-xs text-muted-foreground">PNG, JPG, WebP, MP4, WebM · até 50MB</span>
            </>
          )}
        </button>
      )}
      {url && (
        <div className="border border-border rounded-md p-3 space-y-2">
          {isImage && (
            <img src={url} alt="preview" className="max-h-48 mx-auto rounded" />
          )}
          {isVideo && (
            <video src={url} controls className="max-h-48 mx-auto rounded w-full" />
          )}
          <div className="flex items-center gap-2">
            <Input
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              className="text-xs flex-1"
              placeholder="https://..."
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              title="Trocar arquivo"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onUrlChange("")}
              title="Remover"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-rose-400 mt-1">{error}</p>}
    </div>
  );
}

function CriativoDialog({
  open,
  onOpenChange,
  editing,
  defaultEtapa,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: CriativoKanban | null;
  defaultEtapa: Etapa;
}) {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState<Tipo>("imagem");
  const [etapa, setEtapa] = useState<Etapa>("ideia");
  const [thumbUrl, setThumbUrl] = useState("");
  const [url, setUrl] = useState("");
  const [notas, setNotas] = useState("");

  // Reset form quando abre/troca de edição
  if (open && editing && editing.titulo !== titulo && titulo === "") {
    setTitulo(editing.titulo);
    setDescricao(editing.descricao ?? "");
    setTipo(editing.tipo);
    setEtapa(editing.etapa);
    setThumbUrl(editing.thumbUrl ?? "");
    setUrl(editing.url ?? "");
    setNotas(editing.notas ?? "");
  }

  function reset() {
    setTitulo("");
    setDescricao("");
    setTipo("imagem");
    setEtapa(defaultEtapa);
    setThumbUrl("");
    setUrl("");
    setNotas("");
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = {
        titulo,
        descricao: descricao || null,
        tipo,
        etapa,
        thumbUrl: thumbUrl || null,
        url: url || null,
        notas: notas || null,
      };
      if (editing) {
        return api.patch<CriativoKanban>(`/api/criativos-kanban/${editing.id}`, data);
      }
      return api.post<CriativoKanban>("/api/criativos-kanban", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["criativos-kanban"] });
      reset();
      onOpenChange(false);
    },
  });

  // Sincroniza etapa default quando abre pra novo
  if (open && !editing && etapa === "ideia" && defaultEtapa !== "ideia") {
    setEtapa(defaultEtapa);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar criativo" : "Novo criativo"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Título *</Label>
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder='Ex: "Pare de torrar verba em criativo que não converte"'
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as Tipo)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="imagem">🖼️ Imagem</SelectItem>
                  <SelectItem value="video">🎬 Vídeo</SelectItem>
                  <SelectItem value="carrossel">🎠 Carrossel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Etapa</Label>
              <Select value={etapa} onValueChange={(v) => setEtapa(v as Etapa)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ideia">💡 Ideia</SelectItem>
                  <SelectItem value="produzido">🔨 Produzido</SelectItem>
                  <SelectItem value="testado">🧪 Testado</SelectItem>
                  <SelectItem value="recusado">❌ Recusado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Descrição / conceito</Label>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Descreva a ideia, o ângulo, o gancho do criativo..."
              rows={3}
            />
          </div>
          <UploadField
            url={url}
            onUrlChange={(u) => {
              setUrl(u);
              // se for imagem, auto-popula a thumb também
              if (u && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u)) setThumbUrl(u);
            }}
            onTypeDetected={(t) => {
              if (t.startsWith("video/")) setTipo("video");
              else if (t.startsWith("image/")) setTipo("imagem");
            }}
          />
          <div>
            <Label className="text-xs text-muted-foreground">URL da thumb (opcional, sobrepõe preview)</Label>
            <Input
              value={thumbUrl}
              onChange={(e) => setThumbUrl(e.target.value)}
              placeholder="https://..."
              className="text-xs"
            />
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Resultado do teste, feedback, etc."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!titulo.trim() || saveMutation.isPending}
          >
            {saveMutation.isPending ? "Salvando..." : editing ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
