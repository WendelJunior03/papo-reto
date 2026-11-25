/** O que o aparelho sabe fazer: app instalado, iPhone e notificações. */
export const isIOS = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent);

export const isStandalone = (): boolean =>
  matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** No iPhone, só existe com o app instalado na Tela de Início (iOS 16.4+). */
export const canPush = (): boolean => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
