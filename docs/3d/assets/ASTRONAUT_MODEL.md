# The astronaut model (AI-generated)

`astronaut.glb` is an **AI-generated 3D model**. It is shown in the 3D walk with a visible label:
"AI-generated 3D model (Higgsfield)".

| | |
|---|---|
| Tool | Higgsfield (3D generation) |
| Model | Meshy 6 Text to 3D (`meshy_v6_text_to_3d`), with its automatic rig and the stock "Casual_Walk" clip |
| Made | 15 November 2026, one generation |
| Settings | full mode (textured), A-pose, 30,000 triangles, symmetry on, rig height 1.8 m, animation clip 30 |

**Prompt (in full):**

> A realistic astronaut wearing a plain white Mars surface EVA spacesuit, full body, standing upright in an A-pose.
> Round helmet with a gold mirrored sun visor pulled fully down so no face is visible. Life-support backpack, grey
> gloves, grey boots, soft fabric suit with ribbed joints at the shoulders, elbows and knees. The suit is completely
> plain: no logos, no flags, no patches, no text, no letters, no numbers, no insignia, no mission marks.

**What we changed after the generation (by code, not by AI):**

- The generator still drew a flag patch on one shoulder and a small coloured oval on the chest. Both were painted
  over with plain suit white in the texture, so the suit carries no flags, logos or mission marks.
- The texture was made smaller (2048 px to 1024 px) and unused data was dropped, so the file is 2.9 MB instead of 7.1 MB.
- The coloured arm bands (EV1 red, EV2 blue) are added by the page's code (`crew.js`).

The model is an illustration of a crew member. It is not a real suit design and it is not NASA material.
