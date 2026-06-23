// api/generer.js — v4 — polices TTF + accents + montants manuscrits

const path = require('path');
const fs   = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

module.exports.config = { api: { bodyParser: false, responseLimit: '50mb' } };

const GREEN = rgb(0, 156/255, 116/255);
const BLACK = rgb(0, 0, 0);
const GRAY  = rgb(0.5, 0.5, 0.5);
const DGRAY = rgb(0.3, 0.3, 0.3);
const WHITE = rgb(1, 1, 1);
const PW = 595.28, PH = 841.89, ML = 50, MR = 545, CW = MR - ML;

// ─── Parser multipart ────────────────────────────────────────────────────────
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const Busboy = require('busboy');
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024 } });
    const fields = {}, files = {};
    bb.on('field', (n, v) => { fields[n] = v; });
    bb.on('file',  (n, f) => {
      const c = [];
      f.on('data', d => c.push(d));
      f.on('end',  () => { files[n] = Buffer.concat(c); });
      f.on('error', reject);
    });
    bb.on('finish', () => resolve({ fields, files }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

function dateFr(d = new Date()) {
  const m = ['janvier','février','mars','avril','mai','juin',
             'juillet','août','septembre','octobre','novembre','décembre'];
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Claude : extraire N devis depuis le PDF ─────────────────────────────────
async function extraireInfosDevis(buf, nbLots) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const instrManuscrit = `RÈGLE IMPORTANTE sur les montants manuscrits : Si un montant imprimé est barré et qu'un montant est réécrit à la main à côté ou en dessous, tu dois TOUJOURS utiliser le montant manuscrit et ignorer le montant barré. Par exemple si "CHF 40'044.80" est barré et que "CHF 40'000.-" est écrit à la main, le montant à retenir est CHF 40'000.00.`;

  const promptUnique = `Extrais les informations de ce devis. ${instrManuscrit}
RÈGLE ARRÊTÉ : Si le devis contient un montant "arrêté" ou "total arrêté" — qu'il soit écrit à la main OU imprimé informatiquement — ajoute une ligne "Total arrêté TTC" avec ce montant.
Retourne UNIQUEMENT un JSON valide sans markdown :
{
  "adresseEntreprise": "rue et numéro de l'entreprise",
  "npVilleEntreprise": "NPA et ville",
  "telephoneEntreprise": "téléphone(s)",
  "devis": [
    {
      "noDevis": "numéro du devis",
      "dateDevis": "date JJ.MM.AAAA",
      "lignesFinancieres": [
        { "label": "Montant total brut", "montant": "X'XXX.XX", "bold": true },
        { "label": "Remise X%", "montant": "- X'XXX.XX", "bold": false },
        { "label": "Montant hors taxes", "montant": "X'XXX.XX", "bold": true },
        { "label": "TVA 8.1%", "montant": "X'XXX.XX", "bold": false },
        { "label": "Total TTC", "montant": "X'XXX.XX", "bold": true },
        { "label": "Total arrêté TTC", "montant": "X'XXX.XX", "bold": true }
      ]
    }
  ]
}
Inclure "Total arrêté TTC" UNIQUEMENT si un arrêté manuscrit est présent. Inclure uniquement les lignes financières présentes. Ne jamais inventer.`;

  const promptDouble = `Ce PDF contient 2 devis distincts de la même entreprise. ${instrManuscrit}
RÈGLE ARRÊTÉ : Si un devis contient un montant "arrêté" ou "total arrêté" — qu'il soit écrit à la main OU imprimé informatiquement — ajoute une ligne "Total arrêté TTC" avec ce montant pour ce devis.
Retourne UNIQUEMENT un JSON valide sans markdown :
{
  "adresseEntreprise": "rue et numéro",
  "npVilleEntreprise": "NPA et ville",
  "telephoneEntreprise": "téléphone(s)",
  "devis": [
    {
      "noDevis": "numéro du premier devis",
      "dateDevis": "date JJ.MM.AAAA",
      "lignesFinancieres": [
        { "label": "Montant total brut", "montant": "X'XXX.XX", "bold": true },
        { "label": "Remise X%", "montant": "- X'XXX.XX", "bold": false },
        { "label": "Montant hors taxes", "montant": "X'XXX.XX", "bold": true },
        { "label": "TVA 8.1%", "montant": "X'XXX.XX", "bold": false },
        { "label": "Total TTC", "montant": "X'XXX.XX", "bold": true },
        { "label": "Total arrêté TTC", "montant": "X'XXX.XX", "bold": true }
      ]
    },
    {
      "noDevis": "numéro du deuxième devis",
      "dateDevis": "date JJ.MM.AAAA",
      "lignesFinancieres": [
        { "label": "Montant total brut", "montant": "X'XXX.XX", "bold": true },
        { "label": "TVA 8.1%", "montant": "X'XXX.XX", "bold": false },
        { "label": "Total TTC", "montant": "X'XXX.XX", "bold": true }
      ]
    }
  ]
}
Inclure "Total arrêté TTC" UNIQUEMENT si un arrêté manuscrit est présent pour ce devis.
Premier élément = premier devis. Deuxième = deuxième devis. Ne jamais inventer.`;

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } },
      { type: 'text', text: nbLots === 2 ? promptDouble : promptUnique }
    ]}]
  });

  const raw = resp.content[0].text;
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Réponse IA invalide : JSON non trouvé');
  return JSON.parse(raw.slice(start, end + 1));
}

// ─── Helpers PDF ─────────────────────────────────────────────────────────────
function wrapText(font, text, size, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawWrapped(page, font, text, x, y, size, color, maxW) {
  const lh = size + 3;
  wrapText(font, text, size, maxW).forEach(l => {
    page.drawText(l, { x, y, font, size, color });
    y -= lh;
  });
  return y;
}

function drawBullet(page, R, text, x, y, maxW) {
  const dash = '- ';
  const dw = R.widthOfTextAtSize(dash, 9);
  page.drawText(dash, { x, y, font: R, size: 9, color: BLACK });
  const lines = wrapText(R, text, 9, maxW - dw);
  lines.forEach(l => {
    page.drawText(l, { x: x + dw, y, font: R, size: 9, color: BLACK });
    y -= 12;
  });
  return y - 3;
}

function artTitle(page, B, titre, y) {
  page.drawText(titre, { x: ML, y, font: B, size: 9.5, color: BLACK });
  return y - 14;
}

function drawLogo(page, logoImg, xRight, yTop, side) {
  if (!logoImg) return;
  const scale = Math.min(side / logoImg.width, side / logoImg.height);
  page.drawImage(logoImg, {
    x: xRight - logoImg.width * scale,
    y: yTop - logoImg.height * scale,
    width:  logoImg.width  * scale,
    height: logoImg.height * scale,
  });
}

// ─── PAGE 1 : Lettre de garde ─────────────────────────────────────────────────
async function pageLettreGarde(pdfDoc, fonts, logoImg, infos, fd) {
  const { R, B } = fonts;
  const page = pdfDoc.addPage([PW, PH]);

  drawLogo(page, logoImg, MR, PH - 30, 85);

  let y = PH - 50;
  page.drawText('Legato SA', { x: ML, y, font: B, size: 10, color: BLACK }); y -= 13;
  page.drawText('Rue de la Plaine 46', { x: ML, y, font: R, size: 9, color: BLACK }); y -= 12;
  page.drawText('1400 Yverdon-les-Bains', { x: ML, y, font: R, size: 9, color: BLACK }); y -= 12;
  page.drawText('024 426 77 00  ·  info@legato-eg.ch', { x: ML, y, font: R, size: 9, color: BLACK });

  // Adresse destinataire remontee de ~3.5cm par rapport a avant
  let ey = PH - 115;
  const nomComplet = `${fd.nomEntreprise} ${fd.formeJuridique}`;
  page.drawText(nomComplet, { x: 340, y: ey, font: B, size: 12, color: BLACK }); ey -= 16;
  if (infos.adresseEntreprise)  { page.drawText(infos.adresseEntreprise,  { x: 340, y: ey, font: R, size: 12, color: BLACK }); ey -= 15; }
  if (infos.npVilleEntreprise)  { page.drawText(infos.npVilleEntreprise,  { x: 340, y: ey, font: R, size: 12, color: BLACK }); }

  y = PH - 330;
  page.drawText(`Yverdon-les-Bains, le ${dateFr()}`, { x: ML, y, font: R, size: 9, color: BLACK }); y -= 32;

  page.drawText('Concerne :', { x: ML, y, font: B, size: 9, color: BLACK });
  page.drawText("Votre exemplaire du contrat d'entreprise", { x: ML + 68, y, font: R, size: 9, color: BLACK }); y -= 17;
  page.drawText(`Projet : ${fd.nomChantier} — ${fd.adresseProjet}`, { x: ML, y, font: R, size: 9, color: DGRAY }); y -= 13;

  fd.lots.forEach(lot => {
    page.drawText(`CFC ${lot.cfcNumero}  ${lot.cfcLibelle}`, { x: ML, y, font: R, size: 9, color: DGRAY });
    y -= 13;
  });
  y -= 15;

  page.drawText('Madame, Monsieur,', { x: ML, y, font: R, size: 9, color: BLACK }); y -= 17;
  y = drawWrapped(page, R,
    "Vous trouverez ci-joint votre contrat d'entreprise en deux exemplaires, les conditions générales de Legato SA ainsi que le devis correspondant. Les instructions relatives à la suite à donner figurent en page suivante.",
    ML, y, 9, BLACK, CW);
  y -= 30;
  page.drawText('Meilleures salutations,', { x: ML, y, font: R, size: 9, color: BLACK }); y -= 15;
  page.drawText('Legato SA', { x: ML, y, font: B, size: 9, color: BLACK });
}

// ─── Recto contrat ────────────────────────────────────────────────────────────
async function pageContratRecto(pdfDoc, fonts, logoImg, infoDevis, infos, lot, fd) {
  const { R, B } = fonts;
  const page = pdfDoc.addPage([PW, PH]);

  drawLogo(page, logoImg, MR, PH - 30, 70);

  let y = PH - 48;
  page.drawText('DOCUMENT CONTRACTUEL', { x: ML, y, font: R, size: 7.5, color: GRAY }); y -= 20;
  page.drawText("Contrat d'entreprise", { x: ML, y, font: B, size: 23, color: GREEN }); y -= 20;
  page.drawText(fd.nomChantier, { x: ML, y, font: R, size: 10, color: GRAY }); y -= 13;
  page.drawText(fd.adresseProjet, { x: ML, y, font: R, size: 10, color: GRAY }); y -= 20;

  const bY = y, bH = 62, bWL = 242, bWR = 235;
  const bXL = ML, bXR = ML + bWL + 14;
  page.drawRectangle({ x: bXL, y: bY - bH, width: bWL, height: bH, borderColor: GRAY, borderWidth: 0.5, color: WHITE });
  page.drawRectangle({ x: bXR, y: bY - bH, width: bWR, height: bH, borderColor: GRAY, borderWidth: 0.5, color: WHITE });

  let by = bY - 9;
  page.drawText("MAÎTRE D'OUVRAGE", { x: bXL+7, y: by, font: R, size: 7, color: GRAY }); by -= 13;
  page.drawText('Legato SA',              { x: bXL+7, y: by, font: B, size: 9, color: BLACK }); by -= 11;
  page.drawText('Rue de la Plaine 46',    { x: bXL+7, y: by, font: R, size: 8.5, color: BLACK }); by -= 10;
  page.drawText('1400 Yverdon-les-Bains', { x: bXL+7, y: by, font: R, size: 8.5, color: BLACK }); by -= 10;
  page.drawText('024 426 77 00',          { x: bXL+7, y: by, font: R, size: 8.5, color: BLACK });

  const nomComplet = `${fd.nomEntreprise} ${fd.formeJuridique}`;
  by = bY - 9;
  page.drawText('ENTREPRENEUR', { x: bXR+7, y: by, font: R, size: 7, color: GRAY }); by -= 13;
  page.drawText(nomComplet,     { x: bXR+7, y: by, font: B, size: 9, color: BLACK }); by -= 11;
  if (infos.adresseEntreprise)   { page.drawText(infos.adresseEntreprise,   { x: bXR+7, y: by, font: R, size: 8.5, color: BLACK }); by -= 10; }
  if (infos.npVilleEntreprise)   { page.drawText(infos.npVilleEntreprise,   { x: bXR+7, y: by, font: R, size: 8.5, color: BLACK }); by -= 10; }
  if (infos.telephoneEntreprise) { page.drawText(infos.telephoneEntreprise, { x: bXR+7, y: by, font: R, size: 8.5, color: BLACK }); }

  y = bY - bH - 14;
  page.drawText(`CFC ${lot.cfcNumero}  ${lot.cfcLibelle}`, { x: ML, y, font: B, size: 9, color: BLACK }); y -= 12;
  page.drawText(`Selon devis ${infoDevis.noDevis || '...'} du ${infoDevis.dateDevis || '...'}`, { x: ML, y, font: R, size: 8.5, color: GRAY }); y -= 17;

  page.drawText('Récapitulatif :', { x: ML, y, font: B, size: 9, color: BLACK }); y -= 13;
  const lignes = infoDevis.lignesFinancieres || [];
  for (const lg of lignes) {
    const f = lg.bold ? B : R;
    page.drawText(lg.label, { x: ML, y, font: f, size: 9, color: BLACK });
    const mt = `CHF    ${lg.montant}`;
    page.drawText(mt, { x: MR - f.widthOfTextAtSize(mt, 9), y, font: f, size: 9, color: BLACK });
    y -= 12;
  }
  y -= 8;
  page.drawLine({ start: { x: ML, y }, end: { x: MR, y }, thickness: 0.3, color: GRAY }); y -= 14;

  // ── Articles 1 à 3.2 (début) ──────────────────────────────────────────────
  y = artTitle(page, B, 'Article 1 : Objet du contrat', y);
  y = drawBullet(page, R, "Le Maître d'ouvrage est une entreprise générale construisant des villas ou autres bâtiments clés en main. Il entend confier à l'entrepreneur les travaux précités.", ML+8, y, CW-8); y -= 7;

  y = artTitle(page, B, 'Article 2 : Prix', y);
  y = drawBullet(page, R, "Les plus-et/ou moins-values seront précisées de cas en cas par commande écrite du Maître d'ouvrage.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Le Maître d'ouvrage pourra refuser le paiement de tous travaux qu'il n'aurait pas expressément commandés ou dont le prix n'aurait pas été expressément accepté par lui avant leur exécution.", ML+8, y, CW-8); y -= 7;

  y = artTitle(page, B, 'Article 3.1 : Délais', y);
  y = drawBullet(page, R, "Avant le début de la construction, le Maître d'ouvrage remet à l'entrepreneur un planning indiquant la période pendant laquelle il doit réaliser les travaux qui lui incombent et un délai d'exécution.", ML+8, y, CW-8);
  y = drawBullet(page, R, "L'entrepreneur s'engage à réaliser les travaux pendant cette période et délai indiqué. Il ne peut en aucun cas invoquer un manque ou l'absence (pour quelque motif que ce soit) de personnel pour retarder l'exécution des travaux. En revanche, la société Legato SA s'engage à faire les choix et détails dans des délais acceptables.", ML+8, y, CW-8);
  y = drawBullet(page, R, "L'entrepreneur s'engage à suivre les ordres et les instructions donnés par le Maître d'ouvrage qui est seul habilité à planifier et à coordonner la construction de l'ouvrage entre les divers maîtres d'état. L'entrepreneur a l'obligation d'assister aux réunions de chantier prévues, sur convocation du Maître d'ouvrage.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Pour le surplus, l'art. 92 de la norme SIA 118 est applicable.", ML+8, y, CW-8); y -= 7;

  y = artTitle(page, B, 'Article 3.2 : Pénalités', y);
  y = drawBullet(page, R, "Le planning détaillé transmis par la Direction des Travaux est réputé accepté en l'absence de réserve écrite dans un délai de 5 jours ouvrables", ML+8, y, CW-8);
  y = drawBullet(page, R, "Tout retard constaté par rapport au planning fera l'objet d'un courrier de constat adressé à l'entreprise", ML+8, y, CW-8);
  y = drawBullet(page, R, "L'entreprise devra mettre les moyens pour rattraper ce retard dans un délai de 3 jours ouvrables.", ML+8, y, CW-8);
  drawBullet(page, R, "À défaut de rétablissement de la situation dans le délai imparti, une mise en demeure sera notifiée.", ML+8, y, CW-8);
}

// ─── Verso contrat ────────────────────────────────────────────────────────────
async function pageContratVerso(pdfDoc, fonts, infoDevis, infos, lot, fd) {
  const { R, B } = fonts;
  const page = pdfDoc.addPage([PW, PH]);
  let y = PH - 55;

  y = drawBullet(page, R, "Après mise en demeure restée sans effet, une pénalité de CHF 500.- par jour calendaire de retard pourra être appliquée, plafonnée à 10 % du montant du marché.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Tous les frais induits par le retard (coordination supplémentaire, immobilisation d'autres entreprises, locations, moyens provisoires, déplacements supplémentaires de la Direction des Travaux, etc.) seront facturés à l'entreprise responsable.", ML+8, y, CW-8);
  y = drawBullet(page, R, "En cas de retard mettant en péril le planning général du chantier, la Direction des Travaux pourra exiger un renforcement immédiat des effectifs.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Si le retard persiste malgré les mesures précitées, le Maître d'Ouvrage se réserve le droit de faire exécuter tout ou partie des prestations par une entreprise tierce aux frais et risques de l'entreprise défaillante.", ML+8, y, CW-8); y -= 7;

  y = artTitle(page, B, "Article 4 : Assurance de l'entreprise selon art. 26 al. 1 de la norme SIA 118", y);
  y = drawBullet(page, R, "L'entrepreneur déclare être couvert pour les dommages causés aux personnes ou aux biens par une assurance responsabilité civile à l'égard des tiers.", ML+8, y, CW-8);
  page.drawText('Compagnie et n° :                      .........................................................', { x: ML+8, y, font: R, size: 9, color: BLACK }); y -= 12;
  page.drawText('Prestation maximale par dommage :       .........................................................', { x: ML+8, y, font: R, size: 9, color: BLACK }); y -= 16;

  y = artTitle(page, B, 'Article 5 : Conditions', y);
  page.drawText('5.1 Conditions de paiement (selon normes SIA 118 art. 144)', { x: ML+8, y, font: B, size: 9, color: BLACK }); y -= 13;
  y = drawBullet(page, R, "90% sur situations suivant l'avance des travaux.", ML+8, y, CW-8);
  y = drawBullet(page, R, "10% à la fin des travaux (réceptionnés par le Maître d'ouvrage), contre remise par l'entrepreneur d'une garantie bancaire ou d'assurance et après le versement du solde du contrat d'entreprise générale par le maître d'ouvrage.", ML+8, y, CW-8); y -= 5;
  page.drawText('5.2 Conditions générales', { x: ML+8, y, font: B, size: 9, color: BLACK }); y -= 13;
  y = drawBullet(page, R, "Les CONDITIONS GÉNÉRALES POUR UN CONTRAT D'ENTREPRISE de Legato SA font partie intégrante du présent contrat.", ML+8, y, CW-8);
  y = drawBullet(page, R, "En cas de contradiction entre divers documents du contrat, l'ordre de priorité s'établit selon l'art. 21 al. 1 de la norme SIA 118, dans le cas d'une contre-offre selon l'art. 22 al. 4.", ML+8, y, CW-8); y -= 7;

  y = artTitle(page, B, 'Article 6 : Garanties', y);
  y = drawBullet(page, R, "Les garanties données par l'entrepreneur sur les travaux effectués contre les défauts apparents et cachés sont conformes à celles prévues par la norme SIA 118, sans restriction.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Le Maître d'ouvrage est en droit de réclamer à l'entrepreneur le remboursement intégral de toute indemnité que le Maître d'ouvrage devrait verser au propriétaire (maître de l'ouvrage du contrat d'entreprise générale liant Legato SA) à la suite d'une faute ou d'une négligence commise par l'entrepreneur dans l'exécution des travaux qui lui incombent.", ML+8, y, CW-8); y -= 7;

  y = artTitle(page, B, 'Article 7 : For selon art. 37 de la norme SIA 118', y);
  y = drawBullet(page, R, "Les parties conviennent qu'en cas de contestation, le for sera au lieu de situation de l'ouvrage.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Le présent contrat, établi en 2 exemplaires engage, réciproquement par leur signature, l'entrepreneur (le fournisseur) et le Maître d'ouvrage.", ML+8, y, CW-8); y -= 25;

  page.drawText(`Lieu et date : Yverdon-les-Bains, le ${dateFr()}`, { x: ML, y, font: R, size: 9, color: BLACK }); y -= 35;

  const nomComplet = `${fd.nomEntreprise} ${fd.formeJuridique}`;
  const sxR = MR - 200;
  page.drawText("Le Maître d'ouvrage", { x: ML,  y, font: B, size: 8.5, color: BLACK });
  page.drawText("L'entrepreneur",       { x: sxR, y, font: B, size: 8.5, color: BLACK }); y -= 13;
  page.drawText('Legato SA',            { x: ML,  y, font: R, size: 9, color: BLACK });
  page.drawText(nomComplet,             { x: sxR, y, font: R, size: 9, color: BLACK }); y -= 32;
  page.drawText('Signature : ................................', { x: ML,  y, font: R, size: 9, color: BLACK });
  page.drawText('Signature : ................................', { x: sxR, y, font: R, size: 9, color: BLACK });
}

// ─── HANDLER PRINCIPAL ───────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Méthode non autorisée'); return; }
  try {
    const { fields, files } = await parseForm(req);

    const reqF = ['nomChantier','adresseProjet','nomEntreprise','formeJuridique','cfcNumero1','cfcLibelle1'];
    for (const f of reqF) {
      if (!fields[f] || !fields[f].toString().trim()) {
        res.status(400).json({ error: `Champ manquant : ${f}` }); return;
      }
    }

    const lots = [{ cfcNumero: fields.cfcNumero1.toString().trim(), cfcLibelle: fields.cfcLibelle1.toString().trim() }];
    if (fields.cfcNumero2 && fields.cfcNumero2.toString().trim() && fields.cfcLibelle2 && fields.cfcLibelle2.toString().trim()) {
      lots.push({ cfcNumero: fields.cfcNumero2.toString().trim(), cfcLibelle: fields.cfcLibelle2.toString().trim() });
    }

    const fd = {
      nomChantier:    fields.nomChantier.toString().trim(),
      adresseProjet:  fields.adresseProjet.toString().trim(),
      nomEntreprise:  fields.nomEntreprise.toString().trim(),
      formeJuridique: fields.formeJuridique.toString().trim(),
      lots,
    };

    const devisBuffer = files.devis;
    if (!devisBuffer || !devisBuffer.length) {
      res.status(400).json({ error: 'Devis PDF manquant' }); return;
    }

    const infos = await extraireInfosDevis(devisBuffer, lots.length);
    if (!infos.devis || !Array.isArray(infos.devis) || infos.devis.length === 0) {
      infos.devis = [{ noDevis: '', dateDevis: '', lignesFinancieres: [] }];
    }
    while (infos.devis.length < lots.length) {
      infos.devis.push(infos.devis[infos.devis.length - 1]);
    }

    // Assets
    const assetsDir = path.join(__dirname, '..', 'assets');
    const ficheBytes = fs.readFileSync(path.join(assetsDir, 'fiche_attestations.pdf'));
    const cgBytes    = fs.readFileSync(path.join(assetsDir, 'conditions_generales.pdf'));
    const logoPath   = path.join(assetsDir, 'logo_legato.png');
    const logoBytes  = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

    // Polices TTF (avec accents) — debug logs
    console.log('assetsDir:', assetsDir);
    console.log('Lato-Regular existe:', fs.existsSync(path.join(assetsDir, 'Lato-Regular.ttf')));
    console.log('Lato-Bold existe:', fs.existsSync(path.join(assetsDir, 'Lato-Bold.ttf')));
    const regularTTF = new Uint8Array(fs.readFileSync(path.join(assetsDir, 'Lato-Regular.ttf')));
    const boldTTF    = new Uint8Array(fs.readFileSync(path.join(assetsDir, 'Lato-Bold.ttf')));
    console.log('regularTTF size:', regularTTF.length);
    console.log('boldTTF size:', boldTTF.length);

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const B = await pdfDoc.embedFont(boldTTF);
    const R = await pdfDoc.embedFont(regularTTF);
    const fonts = { B, R };

    let logoImg = null;
    if (logoBytes) { try { logoImg = await pdfDoc.embedPng(logoBytes); } catch (_) {} }

    // 1. Lettre de garde
    await pageLettreGarde(pdfDoc, fonts, logoImg, infos, fd);

    // 2. Fiche attestations
    const fichePdf = await PDFDocument.load(ficheBytes);
    (await pdfDoc.copyPages(fichePdf, fichePdf.getPageIndices())).forEach(p => pdfDoc.addPage(p));

    // Annexe optionnelle (même PDF inséré après chaque exemplaire)
    const annexeBuffer = files.annexe && files.annexe.length > 0 ? files.annexe : null;

    // 3+. Contrats par lot x2 exemplaires, avec annexe après chacun
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      const infoDevis = infos.devis[i];

      // Exemplaire 1
      await pageContratRecto(pdfDoc, fonts, logoImg, infoDevis, infos, lot, fd);
      await pageContratVerso(pdfDoc, fonts, infoDevis, infos, lot, fd);
      if (annexeBuffer) {
        const ax1 = await PDFDocument.load(annexeBuffer);
        (await pdfDoc.copyPages(ax1, ax1.getPageIndices())).forEach(p => pdfDoc.addPage(p));
      }

      // Exemplaire 2
      await pageContratRecto(pdfDoc, fonts, logoImg, infoDevis, infos, lot, fd);
      await pageContratVerso(pdfDoc, fonts, infoDevis, infos, lot, fd);
      if (annexeBuffer) {
        const ax2 = await PDFDocument.load(annexeBuffer);
        (await pdfDoc.copyPages(ax2, ax2.getPageIndices())).forEach(p => pdfDoc.addPage(p));
      }
    }

    // Conditions générales
    const cgPdf = await PDFDocument.load(cgBytes);
    (await pdfDoc.copyPages(cgPdf, cgPdf.getPageIndices())).forEach(p => pdfDoc.addPage(p));

    // Devis x2
    const devisPdf = await PDFDocument.load(devisBuffer);
    const idx = devisPdf.getPageIndices();
    (await pdfDoc.copyPages(devisPdf, idx)).forEach(p => pdfDoc.addPage(p));
    (await pdfDoc.copyPages(devisPdf, idx)).forEach(p => pdfDoc.addPage(p));

    const pdfBytes = await pdfDoc.save();
    const nomFichier = `Contrat_${fd.nomEntreprise.replace(/\s+/g,'_')}_${lots.map(l=>`CFC${l.cfcNumero}`).join('_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nomFichier}"`);
    res.status(200).send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error('ERREUR:', err);
    res.status(500).json({ error: 'Erreur génération', detail: err.message });
  }
};
