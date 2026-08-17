// export function isBrowserOffline(): boolean {
//   return typeof navigator !== "undefined" && navigator.onLine === false;
// }

// export function isNetworkError(error: unknown): boolean {
//   if (isBrowserOffline()) return true;
//   if (error instanceof TypeError) return true;
//   if (error instanceof Error) {
//     const msg = error.message.toLowerCase();
//     return (
//       msg.includes("failed to fetch") ||
//       msg.includes("networkerror") ||
//       msg.includes("network request failed") ||
//       msg.includes("load failed")
//     );
//   }
//   return false;
// }

// export function onConnectivityChange(listener: () => void): () => void {
//   if (typeof window === "undefined") return () => {};

//   const handleOnline = () => listener();
//   const handleOffline = () => listener();
//   window.addEventListener("online", handleOnline);
//   window.addEventListener("offline", handleOffline);

//   return () => {
//     window.removeEventListener("online", handleOnline);
//     window.removeEventListener("offline", handleOffline);
//   };
// }






export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function isNetworkError(error: unknown): boolean {
  // Browser explicitly reports offline
  if (isBrowserOffline()) return true;

  if (error instanceof TypeError) return true;

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    return (
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("network request failed") ||
      msg.includes("load failed") ||
      msg.includes("request failed (500)") ||
      msg.includes("request failed (502)") ||
      msg.includes("request failed (503)") ||
      msg.includes("request failed (504)")
    );
  }

  return false;
}

export function onConnectivityChange(
  listener: () => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleOnline = () => listener();
  const handleOffline = () => listener();

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}