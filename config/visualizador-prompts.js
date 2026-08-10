// Prompts de edición para el Visualizador de Ambientes (spike).
// Se separan de la lógica para poder iterarlos sin tocar el endpoint ni el modelo.
// El modelo recibe: [1] la foto real del ambiente, [2..] la(s) imagen(es) de diseño de
// referencia, y este texto. Editá libremente el wording y volvé a probar.

export const PROMPTS = {
  // Reemplazar el PISO usando la 2da imagen (muestra del material) como referencia.
  piso: `Edit this photo of a real room. Replace ONLY the floor with the wood
flooring material shown in the second image (wide planks, keep a realistic
plank scale and lay the planks following the room's perspective and vanishing
lines). Keep everything else exactly as is: furniture, rugs, walls, windows,
doors, plants, ceiling, lighting, shadows and reflections must remain
consistent with the original photo. Do not move or remove any object.
Photorealistic result, same camera angle, same framing, same resolution.`,

  // Cubrir la PARED principal con paneles acústicos de listones (AcuDesign), 2da imagen = referencia.
  pared: `Edit this photo of a real room. Cover ONLY the main visible wall with the
vertical wood slat acoustic panels shown in the second image (thin vertical
slats with dark felt gaps between them, running floor-to-ceiling, following the
wall's perspective). Keep the furniture, floor, other walls, windows, lighting
and shadows unchanged. Do not move or remove any object. Photorealistic result,
same camera angle, same framing, same resolution.`,

  // "Ambos": piso + pared en una sola edición. Referencias: 2da imagen = piso, 3ra imagen = pared.
  ambos: `Edit this photo of a real room in one pass. (1) Replace ONLY the floor with the
wood flooring material shown in the second image (wide planks, realistic scale,
following the room's perspective). (2) Cover ONLY the main visible wall with the
vertical wood slat acoustic panels shown in the third image (thin vertical slats
with dark felt gaps, floor-to-ceiling). Keep furniture, other walls, windows,
lighting, shadows and reflections consistent with the original photo. Do not move
or remove any object. Photorealistic result, same camera angle and framing.`,
};

// Devuelve el prompt para una superficie ("piso" | "pared" | "ambos").
export function promptFor(superficie) {
  return PROMPTS[superficie] || PROMPTS.piso;
}
