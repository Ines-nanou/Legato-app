import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument, StandardFonts, rgb, cmyk } from "pdf-lib";
import fs from "fs";
import path from "path";

export const config = {
  api: { bodyParser: { sizeLimit: "30mb" } },
};

const PROJET = {
  nom: "Construction de 2\u00d72 villas mitoyennes",
  adresse: "Chemin de l'ORMET 68, Ecublens",
  moNom: "Legato SA",
  moAdresse: "Rue de la Plaine 46",
  moNpaVille: "1400 Yverdon-les-Bains",
  moTel: "024 426 77 00",
  moEmail: "info@legato-eg.ch",
};

const VERT_LEGATO = cmyk(0.78, 0, 0.67, 0);

const PROMPT = `Tu analyses un devis PDF d'une entreprise sous-traitante adress\u00e9 \u00e0 Legato SA (ma\u00eetre d'ouvrage, entreprise g\u00e9n\u00e9rale de construction).

Extrais les informations et r\u00e9ponds UNIQUEMENT en JSON valide, sans aucun texte avant ou apr\u00e8s, sans balises markdown.

{
  "entrepriseNom": "raison sociale compl\u00e8te de l'entreprise qui \u00e9met le devis",
  "entrepriseAdresse": "rue et num\u00e9ro",
  "entrepriseNpaVille": "NPA et ville",
  "entrepriseTel": "t\u00e9l\u00e9phone",
  "entrepriseTva": "num\u00e9ro de TVA (format CHE-xxx.xxx.xxx) si pr\u00e9sent, sinon vide",
  "cfc": "code CFC \u00e0 3 chiffres (ex: 230). Si le devis \u00e9crit CFC23, interpr\u00e8te comme 230",
  "cfcLibelle": "intitul\u00e9 clair du lot de travaux (ex: Travaux installations \u00e9lectriques)",
  "devisNumero": "num\u00e9ro/r\u00e9f\u00e9rence du devis ou de l'offre",
  "devisDate": "date du devis au format JJ.MM.AAAA",
  "lignesRecap": [
    {"libelle": "Montant total brut", "montant": nombre, "gras": true},
    {"libelle": "Rabais X%", "montant": nombre n\u00e9gatif, "gras": false},
    {"libelle": "Montant total net", "montant": nombre, "gras": true},
    {"libelle": "TVA X.X%", "montant": nombre, "gras": false},
    {"libelle": "Montant total net, TTC", "montant": nombre, "gras": true}
  ]
}

R\u00e8gles :
- Pour lignesRecap, reproduis EXACTEMENT la cascade financi\u00e8re du devis telle qu'elle appara\u00eet (brut, puis chaque rabais/escompte/arrondi r\u00e9ellement pr\u00e9sent dans l'ordre, puis net, puis TVA, puis TTC). N'invente aucun rabais absent. Adapte-toi \u00e0 la structure r\u00e9elle du devis.
- Mets "gras": true sur les lignes de total (brut, net, TTC) et false sur les rabais/escomptes/TVA.
- Ignore les positions/montants entre parenth\u00e8ses : ce sont des variantes/options NON comptabilis\u00e9es, \u00e0 exclure.
- R\u00e9ponds uniquement avec l'objet JSON.`;

function formatCHF(n) {
  if (n === undefined || n === null || isNaN(Number(n))) return "\u2014";
  const num = Number(n);
  const fixed = Math.abs(num).toFixed(2);
  const [i, d] = fixed.split(".");
  const withSep = i.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${num < 0 ? "\u2013 " : ""}${withSep}.${d}`;
}

function dateAujourdhui() {
  const mois = ["janvier","f\u00e9vrier","mars","avril","mai","juin","juillet","ao\u00fbt","septembre","octobre","novembre","d\u00e9cembre"];
  const d = new Date();
  return `${d.getDate()} ${mois[d.getMonth()]} ${d.getFullYear()}`;
}

function wrap(text, size, maxW, font) {
  const words = String(text).split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

async function chargerLogo(doc) {
  try {
    const logoPath = path.join(process.cwd(), "assets", "logo_legato.png");
    const logoBytes = fs.readFileSync(logoPath);
    return await doc.embedPng(logoBytes);
  } catch (e) {
    console.error("Logo non charg\u00e9:", e.message);
    return null;
  }
}

async function buildPdf(fields, devisBytes) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await chargerLogo(doc);
  const W = 595.28, H = 841.89, M = 56;
  const black = rgb(0.1, 0.1, 0.1), gray = rgb(0.42, 0.42, 0.42), light = rgb(0.95, 0.95, 0.95);
  const today = dateAujourdhui();

  // ---- PAGE 1 : page de garde ----
  {
    const p = doc.addPage([W, H]);
    if (logo) {
      const logoW = 0.20 * W;
      const logoH = logoW * (logo.height / logo.width);
      p.drawImage(logo, { x: W - M - logoW, y: H - 24 - logoH, width: logoW, height: logoH });
    }
    p.drawText(PROJET.moNom, { x: M, y: H - 70, size: 11, font: bold, color: black });
    p.drawText(PROJET.moAdresse, { x: M, y: H - 85, size: 9, font, color: gray });
    p.drawText(PROJET.moNpaVille, { x: M, y: H - 97, size: 9, font, color: gray });
    p.drawText(`${PROJET.moTel}  \u00b7  ${PROJET.moEmail}`, { x: M, y: H - 109, size: 9, font, color: gray });
    const ay = H - 250;
    [fields.entrepriseNom, fields.entrepriseAdresse, fields.entrepriseNpaVille].filter(Boolean).forEach((l, i) => {
      p.drawText(String(l), { x: M + 250, y: ay - i * 16, size: 11, font: i === 0 ? bold : font, color: black });
    });
    p.drawText(`Yverdon-les-Bains, le ${today}`, { x: M, y: H - 360, size: 10, font, color: black });
    p.drawText("Concerne :", { x: M, y: H - 400, size: 10, font: bold, color: black });
    p.drawText("Votre exemplaire du contrat d'entreprise", { x: M + 70, y: H - 400, size: 10, font, color: black });
    p.drawText(`Projet : ${PROJET.nom} \u2014 ${PROJET.adresse}`, { x: M, y: H - 420, size: 9, font, color: gray });
    if (fields.cfc || fields.cfcLibelle)
      p.drawText(`CFC ${fields.cfc || ""}  ${fields.cfcLibelle || ""}`.trim(), { x: M, y: H - 433, size: 9, font, color: gray });
    p.drawText("Madame, Monsieur,", { x: M, y: H - 470, size: 10, font, color: black });
    const body = "Vous trouverez ci-joint votre contrat d'entreprise en deux exemplaires, les conditions g\u00e9n\u00e9rales de Legato SA ainsi que le devis correspondant. Les instructions relatives \u00e0 la suite \u00e0 donner figurent en page suivante.";
    let y = H - 490;
    wrap(body, 10, W - 2 * M, font).forEach((l) => { p.drawText(l, { x: M, y, size: 10, font, color: black }); y -= 14; });
    p.drawText("Meilleures salutations,", { x: M, y: y - 26, size: 10, font, color: black });
    p.drawText(PROJET.moNom, { x: M, y: y - 42, size: 10, font: bold, color: black });
  }

  // ---- PAGE 2 : Fiche de contr\u00f4le des attestations ----
  try {
    const fichePath = path.join(process.cwd(), "assets", "fiche_attestations.pdf");
    const ficheBytes = fs.readFileSync(fichePath);
    const fichePdf = await PDFDocument.load(ficheBytes);
    const pages = await doc.copyPages(fichePdf, fichePdf.getPageIndices());
    pages.forEach((pg) => doc.addPage(pg));
  } catch (e) {
    console.error("Fiche attestations non ins\u00e9r\u00e9e:", e.message);
  }

  // ---- PAGES CONTRAT (x2) ----
  const drawContract = () => {
    let p = doc.addPage([W, H]);
    let y = H - 60;
    const nl = (need) => { if (y - need < 70) { p = doc.addPage([W, H]); y = H - 60; } };

    if (logo) {
      const logoH = 64;
      const logoW = logoH * (logo.width / logo.height);
      p.drawImage(logo, { x: W - 20 - logoW, y: H - 36 - logoH, width: logoW, height: logoH });
    }

    p.drawText("DOCUMENT CONTRACTUEL", { x: M, y, size: 8, font, color: gray }); y -= 22;
    p.drawText("Contrat d'entreprise", { x: M, y, size: 18, font: bold, color: VERT_LEGATO }); y -= 16;
    p.drawText(PROJET.nom, { x: M, y, size: 10, font, color: black }); y -= 12;
    p.drawText(PROJET.adresse, { x: M, y, size: 10, font, color: gray }); y -= 26;

    const cw = (W - 2 * M - 16) / 2;
    p.drawRectangle({ x: M, y: y - 76, width: cw, height: 76, borderColor: rgb(0.8,0.8,0.8), borderWidth: 0.75 });
    p.drawRectangle({ x: M + cw + 16, y: y - 76, width: cw, height: 76, borderColor: rgb(0.8,0.8,0.8), borderWidth: 0.75 });
    p.drawText("MA\u00ceTRE D'OUVRAGE", { x: M + 8, y: y - 14, size: 8, font: bold, color: gray });
    p.drawText(PROJET.moNom, { x: M + 8, y: y - 28, size: 10, font: bold, color: black });
    p.drawText(PROJET.moAdresse, { x: M + 8, y: y - 41, size: 9, font, color: black });
    p.drawText(PROJET.moNpaVille, { x: M + 8, y: y - 53, size: 9, font, color: black });
    p.drawText(PROJET.moTel, { x: M + 8, y: y - 65, size: 9, font, color: black });
    const c2 = M + cw + 24;
    p.drawText("ENTREPRENEUR", { x: c2, y: y - 14, size: 8, font: bold, color: gray });
    p.drawText(String(fields.entrepriseNom || ""), { x: c2, y: y - 28, size: 10, font: bold, color: black });
    p.drawText(String(fields.entrepriseAdresse || ""), { x: c2, y: y - 41, size: 9, font, color: black });
    p.drawText(String(fields.entrepriseNpaVille || ""), { x: c2, y: y - 53, size: 9, font, color: black });
    let entLine = String(fields.entrepriseTel || "");
    if (fields.entrepriseTva) entLine += `  \u00b7  ${fields.entrepriseTva}`;
    p.drawText(entLine, { x: c2, y: y - 65, size: 8, font, color: black });
    y -= 98;

    p.drawRectangle({ x: M, y: y - 28, width: W - 2 * M, height: 28, color: light });
    p.drawText(`CFC ${fields.cfc || ""}   ${fields.cfcLibelle || ""}`, { x: M + 8, y: y - 12, size: 9, font: bold, color: black });
    p.drawText(`Selon devis ${fields.devisNumero || ""} du ${fields.devisDate || ""}  \u00b7  art. 15 al. 3 et 4, norme SIA 118`, { x: M + 8, y: y - 24, size: 8, font, color: gray });
    y -= 44;

    p.drawText("R\u00c9CAPITULATIF FINANCIER", { x: M, y, size: 9, font: bold, color: black }); y -= 16;
    (fields.lignesRecap || []).forEach((l) => {
      const b = !!l.gras;
      p.drawText(String(l.libelle || ""), { x: M, y, size: 9, font: b ? bold : font, color: black });
      p.drawText("CHF", { x: W - M - 140, y, size: 9, font, color: gray });
      p.drawText(formatCHF(l.montant), { x: W - M - 95, y, size: 9, font: b ? bold : font, color: black });
      y -= 15;
    });
    y -= 12;

    const arts = [
      ["Article 1 : Objet du contrat", ["Le Ma\u00eetre d\u2019ouvrage est une entreprise g\u00e9n\u00e9rale construisant des villas ou autres b\u00e2timents cl\u00e9s en main. Il entend confier \u00e0 l\u2019entrepreneur les travaux pr\u00e9cit\u00e9s."]],
      ["Article 2 : Prix", ["Les plus-et/ou moins-values seront pr\u00e9cis\u00e9es de cas en cas par commande \u00e9crite du Ma\u00eetre d\u2019ouvrage.", "Le Ma\u00eetre d\u2019ouvrage pourra refuser le paiement de tous travaux qu\u2019il n\u2019aurait pas express\u00e9ment command\u00e9s ou dont le prix n\u2019aurait pas \u00e9t\u00e9 express\u00e9ment accept\u00e9 par lui avant leur ex\u00e9cution."]],
      ["Article 3.1 : D\u00e9lais", ["Avant le d\u00e9but de la construction, le Ma\u00eetre d\u2019ouvrage remet \u00e0 l\u2019entrepreneur un planning indiquant la p\u00e9riode pendant laquelle il doit r\u00e9aliser les travaux qui lui incombent et un d\u00e9lai d\u2019ex\u00e9cution.", "L\u2019entrepreneur s\u2019engage \u00e0 r\u00e9aliser les travaux pendant cette p\u00e9riode et d\u00e9lai indiqu\u00e9. Il ne peut en aucun cas invoquer un manque ou l\u2019absence (pour quelque motif que ce soit) de personnel pour retarder l\u2019ex\u00e9cution des travaux. En revanche, la soci\u00e9t\u00e9 Legato SA s\u2019engage \u00e0 faire les choix et d\u00e9tails dans des d\u00e9lais acceptables.", "L\u2019entrepreneur s\u2019engage \u00e0 suivre les ordres et les instructions donn\u00e9s par le Ma\u00eetre d\u2019ouvrage qui est seul habilit\u00e9 \u00e0 planifier et \u00e0 coordonner la construction de l\u2019ouvrage entre les divers ma\u00eetres d\u2019\u00e9tat. L\u2019entrepreneur a l\u2019obligation d\u2019assister aux r\u00e9unions de chantier pr\u00e9vues, sur convocation du Ma\u00eetre d\u2019ouvrage.", "Pour le surplus, l\u2019art. 92 de la norme SIA 118 est applicable."]],
      ["Article 3.2 : P\u00e9nalit\u00e9s", ["Le planning d\u00e9taill\u00e9 transmis par la Direction des Travaux est r\u00e9put\u00e9 accept\u00e9 en l'absence de r\u00e9serve \u00e9crite dans un d\u00e9lai de 5 jours ouvrables.", "Tout retard constat\u00e9 par rapport au planning fera l'objet d'un courrier de constat adress\u00e9 \u00e0 l'entreprise.", "L\u2019entreprise devra mettre les moyens pour rattraper ce retard dans un d\u00e9lai de 3 jours ouvrables.", "\u00c0 d\u00e9faut de r\u00e9tablissement de la situation dans le d\u00e9lai imparti, une mise en demeure sera notifi\u00e9e.", "Apr\u00e8s mise en demeure rest\u00e9e sans effet, une p\u00e9nalit\u00e9 de CHF 500.- par jour calendaire de retard pourra \u00eatre appliqu\u00e9e, plafonn\u00e9e \u00e0 10 % du montant du march\u00e9.", "Tous les frais induits par le retard (coordination suppl\u00e9mentaire, immobilisation d'autres entreprises, locations, moyens provisoires, d\u00e9placements suppl\u00e9mentaires de la Direction des Travaux, etc.) seront factur\u00e9s \u00e0 l'entreprise responsable.", "En cas de retard mettant en p\u00e9ril le planning g\u00e9n\u00e9ral du chantier, la Direction des Travaux pourra exiger un renforcement imm\u00e9diat des effectifs.", "Si le retard persiste malgr\u00e9 les mesures pr\u00e9cit\u00e9es, le Ma\u00eetre d'Ouvrage se r\u00e9serve le droit de faire ex\u00e9cuter tout ou partie des prestations par une entreprise tierce aux frais et risques de l'entreprise d\u00e9faillante."]],
      ["Article 4 : Assurance de l\u2019entreprise selon art. 26 al. 1 de la norme SIA 118", ["L\u2019entrepreneur d\u00e9clare \u00eatre couvert pour les dommages caus\u00e9s aux personnes ou aux biens par une assurance responsabilit\u00e9 civile \u00e0 l\u2019\u00e9gard des tiers.", "Compagnie et n\u00b0 : \u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026..", "Prestation maximale par dommage : \u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026.."]],
      ["Article 5 : Conditions", ["5.1 Conditions de paiement (selon normes SIA 118 art. 144)", "90% sur situations suivant l\u2019avance des travaux.", "10% \u00e0 la fin des travaux (r\u00e9ceptionn\u00e9s par le Ma\u00eetre d\u2019ouvrage), contre remise par l\u2019entrepreneur d\u2019une garantie bancaire ou d\u2019assurance et apr\u00e8s le versement du solde du contrat d\u2019entreprise g\u00e9n\u00e9rale par le ma\u00eetre d\u2019ouvrage.", "5.2 Conditions g\u00e9n\u00e9rales", "Les CONDITIONS G\u00c9N\u00c9RALES POUR UN CONTRAT D\u2019ENTREPRISE de Legato SA font partie int\u00e9grante du pr\u00e9sent contrat.", "En cas de contradiction entre divers documents du contrat, l\u2019ordre de priorit\u00e9 s\u2019\u00e9tablit selon l\u2019art. 21 al. 1 de la norme SIA 118, dans le cas d\u2019une contre-offre selon l\u2019art. 22 al. 4."]],
      ["Article 6 : Garanties", ["Les garanties donn\u00e9es par l\u2019entrepreneur sur les travaux effectu\u00e9s contre les d\u00e9fauts apparents et cach\u00e9s sont conformes \u00e0 celles pr\u00e9vues par la norme SIA 118, sans restriction.", "Le Ma\u00eetre d\u2019ouvrage est en droit de r\u00e9clamer \u00e0 l\u2019entrepreneur le remboursement int\u00e9gral de toute indemnit\u00e9 que le Ma\u00eetre d\u2019ouvrage devrait verser au propri\u00e9taire (ma\u00eetre de l\u2019ouvrage du contrat d\u2019entreprise g\u00e9n\u00e9rale liant Legato SA) \u00e0 la suite d\u2019une faute ou d\u2019une n\u00e9gligence commise par l\u2019entrepreneur dans l\u2019ex\u00e9cution des travaux qui lui incombent."]],
      ["Article 7 : For selon art. 37 de la norme SIA 118", ["Les parties conviennent qu\u2019en cas de contestation, le for sera au lieu de situation de l\u2019ouvrage.", "Le pr\u00e9sent contrat, \u00e9tabli en 2 exemplaires engage, r\u00e9ciproquement par leur signature, l\u2019entrepreneur (le fournisseur) et le Ma\u00eetre d\u2019ouvrage."]],
    ];


    for (const [title, paras] of arts) {
      nl(40);
      p.drawText(title, { x: M, y, size: 9.5, font: bold, color: black }); y -= 14;
      for (const para of paras) {
        for (const l of wrap(para, 8.5, W - 2 * M - 10, font)) { nl(12); p.drawText(l, { x: M + 10, y, size: 8.5, font, color: black }); y -= 11; }
        y -= 3;
      }
      y -= 6;
    }
    nl(90); y -= 10;
    p.drawText(`Lieu et date :  Yverdon-les-Bains, le ${today}`, { x: M, y, size: 9, font, color: black }); y -= 40;
    p.drawText("LE MA\u00ceTRE D'OUVRAGE", { x: M, y, size: 8, font: bold, color: gray });
    p.drawText("L'ENTREPRENEUR", { x: M + cw + 24, y, size: 8, font: bold, color: gray }); y -= 13;
    p.drawText(PROJET.moNom, { x: M, y, size: 9, font, color: black });
    p.drawText(String(fields.entrepriseNom || ""), { x: M + cw + 24, y, size: 9, font, color: black }); y -= 13;
    p.drawText("Signature : \u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026", { x: M, y, size: 9, font, color: gray });
    p.drawText("Signature : \u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026", { x: M + cw + 24, y, size: 9, font, color: gray });
  };
  drawContract();
  drawContract();

  // ---- Fusion : CG (1x) ----
  try {
    const cgPath = path.join(process.cwd(), "assets", "conditions_generales.pdf");
    const cgBytes = fs.readFileSync(cgPath);
    const cgPdf = await PDFDocument.load(cgBytes);
    const pages = await doc.copyPages(cgPdf, cgPdf.getPageIndices());
    pages.forEach((pg) => doc.addPage(pg));
  } catch (e) {
    console.error("CG non ins\u00e9r\u00e9es:", e.message);
  }

  // ---- Fusion : devis original (2x) ----
  try {
    const devisPdf = await PDFDocument.load(devisBytes);
    for (let c = 0; c < 2; c++) {
      const pages = await doc.copyPages(devisPdf, devisPdf.getPageIndices());
      pages.forEach((pg) => doc.addPage(pg));
    }
  } catch (e) {
    console.error("Devis non fusionn\u00e9:", e.message);
  }

  return await doc.save();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "M\u00e9thode non autoris\u00e9e" });
    return;
  }
  try {
    const { devisBase64 } = req.body || {};
    if (!devisBase64) {
      res.status(400).json({ error: "Aucun devis fourni." });
      return;
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: devisBase64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    const text = (msg.content || []).map((b) => b.text || "").join("\n");
    const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    let fields;
    try { fields = JSON.parse(clean); }
    catch (e) {
      const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
      if (a !== -1 && b > a) fields = JSON.parse(clean.slice(a, b + 1));
      else throw new Error("L'IA n'a pas renvoy\u00e9 un JSON exploitable.");
    }
    const devisBytes = Buffer.from(devisBase64, "base64");
    const pdfBytes = await buildPdf(fields, devisBytes);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Contrat_${String(fields.entrepriseNom || "entreprise").replace(/[^a-zA-Z0-9]/g, "_")}.pdf"`);
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
}
