/** Player oficial do YouTube (IFrame API), carregado só quando a aba Música é usada. */
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: string | HTMLElement,
    opts: {
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void; onError?: (e: { data: number }) => void };
    },
  ) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YTNamespace> | null = null;

export function loadYouTube(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("Não deu pra carregar o player do YouTube."));
    };
    document.head.append(s);
  });
  return loading;
}

/** Códigos de erro do player → mensagem. */
export const YT_ERRORS: Record<number, string> = {
  2: "Link de vídeo inválido.",
  5: "Esse vídeo não toca neste navegador.",
  100: "Vídeo não encontrado ou privado.",
  101: "O dono do vídeo não permite tocar fora do YouTube. Escolha outro (versões com letra costumam funcionar).",
  150: "O dono do vídeo não permite tocar fora do YouTube. Escolha outro (versões com letra costumam funcionar).",
};
