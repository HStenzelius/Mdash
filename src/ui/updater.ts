/* Uppdateringar.
 *
 * Appen frågar GitHub vid start om det finns en nyare version. Hittas en får
 * du frågan först -- inget hämtas eller installeras utan att du sagt ja.
 * Går nätet inte att nå säger vi ingenting alls; en anteckningsapp ska inte
 * gnälla om internet när du bara vill skriva. */

import { confirm } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

type Status = (message: string, warn?: boolean) => void;

export async function checkForUpdates(status: Status, announceWhenCurrent = false) {
  let update;
  try {
    update = await check();
  } catch {
    // Offline, eller ingen version släppt än. Båda är helt normala lägen.
    if (announceWhenCurrent) status("Kunde inte nå GitHub", true);
    return;
  }

  if (!update) {
    if (announceWhenCurrent) status("Du har senaste versionen");
    return;
  }

  const notes = update.body?.trim();
  const install = await confirm(
    `Mdash ${update.version} finns att hämta.` +
      (notes ? `\n\n${notes}` : "") +
      `\n\nInstallera nu? Appen startar om när den är klar.`,
    { title: "Uppdatering tillgänglig", okLabel: "Installera", cancelLabel: "Inte nu" }
  );
  if (!install) return;

  try {
    let downloaded = 0;
    let total = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          status("Hämtar uppdatering…");
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          if (total > 0) {
            status(`Hämtar uppdatering… ${Math.round((downloaded / total) * 100)} %`);
          }
          break;
        case "Finished":
          status("Installerar…");
          break;
      }
    });

    await relaunch();
  } catch (err) {
    status(`Uppdateringen misslyckades: ${err}`, true);
  }
}
