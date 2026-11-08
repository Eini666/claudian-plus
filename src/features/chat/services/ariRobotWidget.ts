/**
 * Skrypt okna widgetu — NIE wchodzi do `main.js` przez import. `esbuild.config.mjs`
 * buduje go osobno do IIFE i wstrzykuje jako tekst (`ARI_ROBOT_WIDGET_JS`),
 * a `AriWidget.ts` wkleja go do `data:`-URL okna razem z kontenerem i canvasem.
 * Stan przychodzi pozniej przez `webContents.executeJavaScript('ariRobot.set(…)')`,
 * bez przeladowania strony, wiec robot gra przejscie miedzy stanami zamiast mrugac.
 */

import { type AriLook, fitSize, type MountedRobot, mountRobot } from './ariRobot';

let robot: MountedRobot | null = null;

/** W oknie dostepne jako `ariRobot.set(…)` — `globalName` w `esbuild.config.mjs`. */
export function set(box: HTMLElement, canvas: HTMLCanvasElement, look: AriLook): void {
  if (robot) {
    robot.set(look);
    return;
  }
  // Kontener ma 100% okna — jego wymiar to wymiar okna.
  const width = box.clientWidth;
  const height = box.clientHeight;
  robot = mountRobot(box, canvas, look, { size: fitSize(width, height, true), antenna: true, floorShadow: true, centerIn: { width, height } });
}
