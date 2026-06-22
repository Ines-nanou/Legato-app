// api/generer.js — v3 — support 1 ou 2 lots dans le meme PDF

const path = require('path');
const fs   = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

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
  const m = ['janvier','fevrier','mars','avril','mai','juin',
             'juillet','aout','septembre','octobre','novembre','decembre'];
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Claude : extraire N devis depuis le PDF ─────────────────────────────────
async function extraireInfosDevis(buf, nbLots) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const promptUnique = `Extrais les infos de ce devis. Retourne UNIQUEMENT un JSON valide sans markdown :
{
  "adresseEntreprise": "rue et numero",
  "npVilleEntreprise": "NPA et ville",
  "telephoneEntreprise": "telephone(s)",
  "devis": [
    {
      "noDevis": "numero du devis",
      "dateDevis": "date JJ.MM.AAAA",
      "lignesFinancieres": [
        { "label": "Montant total brut", "montant": "X'XXX.XX", "bold": true },
        { "label": "Remise X%", "montant": "- X'XXX.XX", "bold": false },
        { "label": "Montant hors taxes", "montant": "X'XXX.XX", "bold": true },
        { "label": "TVA 8.1%", "montant": "X'XXX.XX", "bold": false },
        { "label": "Total", "montant": "X'XXX.XX", "bold": true }
      ]
    }
  ]
}
Inclure uniquement les lignes financieres presentes. Ne jamais inventer.`;

  const promptDouble = `Ce PDF contient 2 devis distincts de la meme entreprise. Extrais les infos des 2.
Retourne UNIQUEMENT un JSON valide sans markdown :
{
  "adresseEntreprise": "rue et numero",
  "npVilleEntreprise": "NPA et ville",
  "telephoneEntreprise": "telephone(s)",
  "devis": [
    {
      "noDevis": "numero du premier devis",
      "dateDevis": "date JJ.MM.AAAA",
      "lignesFinancieres": [
        { "label": "Montant total brut", "montant": "X'XXX.XX", "bold": true },
        { "label": "Remise X%", "montant": "- X'XXX.XX", "bold": false },
        { "label": "Montant hors taxes", "montant": "X'XXX.XX", "bold": true },
        { "label": "TVA 8.1%", "montant": "X'XXX.XX", "bold": false },
        { "label": "Total", "montant": "X'XXX.XX", "bold": true }
      ]
    },
    {
      "noDevis": "numero du deuxieme devis",
      "dateDevis": "date JJ.MM.AAAA",
      "lignesFinancieres": [
        { "label": "Montant total brut", "montant": "X'XXX.XX", "bold": true },
        { "label": "TVA 8.1%", "montant": "X'XXX.XX", "bold": false },
        { "label": "Total", "montant": "X'XXX.XX", "bold": true }
      ]
    }
  ]
}
Le premier element du tableau = premier devis trouve dans le PDF.
Le deuxieme element = deuxieme devis.
Inclure uniquement les lignes financieres reellement presentes. Ne jamais inventer.`;

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } },
      { type: 'text', text: nbLots === 2 ? promptDouble : promptUnique }
    ]}]
  });
  return JSON.parse(resp.content[0].text.replace(/```json|```/g, '').trim());
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

  drawLogo(page, logoImg, MR, PH - 42, 120);

  let y = PH - 50;
  page.drawText('Legato SA', { x: ML, y, font: B, size: 10, color: BLACK }); y -= 13;
  page.drawText('Rue de la Plaine 46', { x: ML, y, font: R, size: 9, color: BLACK }); y -= 12;
  page.drawText('1400 Yverdon-les-Bains', { x: ML, y, font: R, size: 9, color: BLACK }); y -= 12;
  page.drawText('024 426 77 00  .  info@legato-eg.ch', { x: ML, y, font: R, size: 9, color: BLACK });

  let ey = PH - 215;
  const nomComplet = `${fd.nomEntreprise} ${fd.formeJuridique}`;
  page.drawText(nomComplet, { x: 340, y: ey, font: B, size: 10, color: BLACK }); ey -= 13;
  if (infos.adresseEntreprise)  { page.drawText(infos.adresseEntreprise,  { x: 340, y: ey, font: R, size: 9, color: BLACK }); ey -= 12; }
  if (infos.npVilleEntreprise)  { page.drawText(infos.npVilleEntreprise,  { x: 340, y: ey, font: R, size: 9, color: BLACK }); }

  y = PH - 330;
  page.drawText(`Yverdon-les-Bains, le ${dateFr()}`, { x: ML, y, font: R, size: 9, color: BLACK }); y -= 32;

  page.drawText('Concerne :', { x: ML, y, font: B, size: 9, color: BLACK });
  page.drawText("Votre exemplaire du contrat d'entreprise", { x: ML + 68, y, font: R, size: 9, color: BLACK }); y -= 17;
  page.drawText(`Projet : ${fd.nomChantier} -- ${fd.adresseProjet}`, { x: ML, y, font: R, size: 9, color: DGRAY }); y -= 13;

  // Lister tous les CFC
  fd.lots.forEach(lot => {
    page.drawText(`CFC ${lot.cfcNumero}  ${lot.cfcLibelle}`, { x: ML, y, font: R, size: 9, color: DGRAY });
    y -= 13;
  });
  y -= 15;

  page.drawText('Madame, Monsieur,', { x: ML, y, font: R, size: 9, color: BLACK }); y -= 17;
  y = drawWrapped(page, R,
    "Vous trouverez ci-joint votre contrat d'entreprise en deux exemplaires, les conditions generales de Legato SA ainsi que le devis correspondant. Les instructions relatives a la suite a donner figurent en page suivante.",
    ML, y, 9, BLACK, CW);
  y -= 30;
  page.drawText('Meilleures salutations,', { x: ML, y, font: R, size: 9, color: BLACK }); y -= 15;
  page.drawText('Legato SA', { x: ML, y, font: B, size: 9, color: BLACK });
}

// ─── Recto contrat (articles 1 a 3.2 debut) ──────────────────────────────────
async function pageContratRecto(pdfDoc, fonts, logoImg, infoDevis, lot, fd) {
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
  page.drawText("MAITRE D'OUVRAGE", { x: bXL+7, y: by, font: R, size: 7, color: GRAY }); by -= 13;
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

  page.drawText('Recapitulatif :', { x: ML, y, font: B, size: 9, color: BLACK }); y -= 13;
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

  y = artTitle(page, B, 'Article 1 : Objet du contrat', y);
  y = drawBullet(page, R, "Le Maitre d'ouvrage est une entreprise generale construisant des villas ou autres batiments cles en main. Il entend confier a l'entrepreneur les travaux precites.", ML+8, y, CW-8); y -= 7;

  y = artTitle(page, B, 'Article 2 : Prix', y);
  y = drawBullet(page, R, "Les plus-et/ou moins-values seront precisees de cas en cas par commande ecrite du Maitre d'ouvrage.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Le Maitre d'ouvrage pourra refuser le paiement de tous travaux qu'il n'aurait pas expressement commandes ou dont le prix n'aurait pas ete expressement accepte par lui avant leur execution.", ML+8, y, CW-8); y -= 7;

  y = artTitle(page, B, 'Article 3.1 : Delais', y);
  y = drawBullet(page, R, "Avant le debut de la construction, le Maitre d'ouvrage remet a l'entrepreneur un planning indiquant la periode pendant laquelle il doit realiser les travaux qui lui incombent et un delai d'execution.", ML+8, y, CW-8);
  y = drawBullet(page, R, "L'entrepreneur s'engage a realiser les travaux pendant cette periode et delai indique. Il ne peut en aucun cas invoquer un manque ou l'absence (pour quelque motif que ce soit) de personnel pour retarder l'execution des travaux. En revanche, la societe Legato SA s'engage a faire les choix et details dans des delais acceptables.", ML+8, y, CW-8);
  y = drawBullet(page, R, "L'entrepreneur s'engage a suivre les ordres et les instructions donnes par le Maitre d'ouvrage qui est seul habilite a planifier et a coordonner la construction de l'ouvrage entre les divers maitres d'etat. L'entrepreneur a l'obligation d'assister aux reunions de chantier prevues, sur convocation du Maitre d'ouvrage.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Pour le surplus, l'art. 92 de la norme SIA 118 est applicable.", ML+8, y, CW-8); y -= 7;

  y = artTitle(page, B, 'Article 3.2 : Penalites', y);
  y = drawBullet(page, R, "Le planning detaille transmis par la Direction des Travaux est repute accepte en l'absence de reserve ecrite dans un delai de 5 jours ouvrables", ML+8, y, CW-8);
  y = drawBullet(page, R, "Tout retard constate par rapport au planning fera l'objet d'un courrier de constat adresse a l'entreprise", ML+8, y, CW-8);
  y = drawBullet(page, R, "L'entreprise devra mettre les moyens pour rattraper ce retard dans un delai de 3 jours ouvrables.", ML+8, y, CW-8);
  drawBullet(page, R, "A defaut de retablissement de la situation dans le delai imparti, une mise en demeure sera notifiee.", ML+8, y, CW-8);
}

// Référence à infos dans les fonctions — correction : passer infos explicitement
// ─── Verso contrat (suite 3.2, articles 4-7, signatures) ─────────────────────
async function pageContratVerso(pdfDoc, fonts, infoDevis, infos, lot, fd) {
  const { R, B } = fonts;
  const page = pdfDoc.addPage([PW, PH]);
  // Pas de logo sur le verso
  let y = PH - 55;

  y = drawBullet(page, R, "Apres mise en demeure restee sans effet, une penalite de CHF 500.- par jour calendaire de retard pourra etre appliquee, plafonnee a 10 % du montant du marche.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Tous les frais induits par le retard (coordination supplementaire, immobilisation d'autres entreprises, locations, moyens provisoires, deplacements supplementaires de la Direction des Travaux, etc.) seront factures a l'entreprise responsable.", ML+8, y, CW-8);
  y = drawBullet(page, R, "En cas de retard mettant en peril le planning general du chantier, la Direction des Travaux pourra exiger un renforcement immediat des effectifs.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Si le retard persiste malgre les mesures precitees, le Maitre d'Ouvrage se reserve le droit de faire executer tout ou partie des prestations par une entreprise tierce aux frais et risques de l'entreprise defaillante.", ML+8, y, CW-8); y -= 7;

  y = artTitle(page, B, "Article 4 : Assurance de l'entreprise selon art. 26 al. 1 de la norme SIA 118", y);
  y = drawBullet(page, R, "L'entrepreneur declare etre couvert pour les dommages causes aux personnes ou aux biens par une assurance responsabilite civile a l'egard des tiers.", ML+8, y, CW-8);
  page.drawText('Compagnie et n.  :                     .........................................................', { x: ML+8, y, font: R, size: 9, color: BLACK }); y -= 12;
  page.drawText('Prestation maximale par dommage :       .........................................................', { x: ML+8, y, font: R, size: 9, color: BLACK }); y -= 16;

  y = artTitle(page, B, 'Article 5 : Conditions', y);
  page.drawText('5.1 Conditions de paiement (selon normes SIA 118 art. 144)', { x: ML+8, y, font: B, size: 9, color: BLACK }); y -= 13;
  y = drawBullet(page, R, "90% sur situations suivant l'avance des travaux.", ML+8, y, CW-8);
  y = drawBullet(page, R, "10% a la fin des travaux (receptionnes par le Maitre d'ouvrage), contre remise par l'entrepreneur d'une garantie bancaire ou d'assurance et apres le versement du solde du contrat d'entreprise generale par le maitre d'ouvrage.", ML+8, y, CW-8); y -= 5;
  page.drawText('5.2 Conditions generales', { x: ML+8, y, font: B, size: 9, color: BLACK }); y -= 13;
  y = drawBullet(page, R, "Les CONDITIONS GENERALES POUR UN CONTRAT D'ENTREPRISE de Legato SA font partie integrante du present contrat.", ML+8, y, CW-8);
  y = drawBullet(page, R, "En cas de contradiction entre divers documents du contrat, l'ordre de priorite s'etablit selon l'art. 21 al. 1 de la norme SIA 118, dans le cas d'une contre-offre selon l'art. 22 al. 4.", ML+8, y, CW-8); y -= 7;

  y = artTitle(page, B, 'Article 6 : Garanties', y);
  y = drawBullet(page, R, "Les garanties donnees par l'entrepreneur sur les travaux effectues contre les defauts apparents et caches sont conformes a celles prevues par la norme SIA 118, sans restriction.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Le Maitre d'ouvrage est en droit de reclamer a l'entrepreneur le remboursement integral de toute indemnite que le Maitre d'ouvrage devrait verser au proprietaire (maitre de l'ouvrage du contrat d'entreprise generale liant Legato SA) a la suite d'une faute ou d'une negligence commise par l'entrepreneur dans l'execution des travaux qui lui incombent.", ML+8, y, CW-8); y -= 7;

  y = artTitle(page, B, 'Article 7 : For selon art. 37 de la norme SIA 118', y);
  y = drawBullet(page, R, "Les parties conviennent qu'en cas de contestation, le for sera au lieu de situation de l'ouvrage.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Le present contrat, etabli en 2 exemplaires engage, reciproquement par leur signature, l'entrepreneur (le fournisseur) et le Maitre d'ouvrage.", ML+8, y, CW-8); y -= 25;

  page.drawText(`Lieu et date : Yverdon-les-Bains, le ${dateFr()}`, { x: ML, y, font: R, size: 9, color: BLACK }); y -= 35;

  const nomComplet = `${fd.nomEntreprise} ${fd.formeJuridique}`;
  const sxR = MR - 200;
  page.drawText("Le Maitre d'ouvrage", { x: ML,  y, font: B, size: 8.5, color: BLACK });
  page.drawText("L'entrepreneur",       { x: sxR, y, font: B, size: 8.5, color: BLACK }); y -= 13;
  page.drawText('Legato SA',            { x: ML,  y, font: R, size: 9, color: BLACK });
  page.drawText(nomComplet,             { x: sxR, y, font: R, size: 9, color: BLACK }); y -= 32;
  page.drawText('Signature : ................................', { x: ML,  y, font: R, size: 9, color: BLACK });
  page.drawText('Signature : ................................', { x: sxR, y, font: R, size: 9, color: BLACK });
}

// ─── HANDLER PRINCIPAL ───────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Methode non autorisee'); return; }
  try {
    const { fields, files } = await parseForm(req);

    // Validation champs communs
    const reqF = ['nomChantier','adresseProjet','nomEntreprise','formeJuridique','cfcNumero1','cfcLibelle1'];
    for (const f of reqF) {
      if (!fields[f] || !fields[f].toString().trim()) {
        res.status(400).json({ error: `Champ manquant : ${f}` }); return;
      }
    }

    // Construction des lots
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

    // Extraction IA (1 ou 2 devis)
    const infos = await extraireInfosDevis(devisBuffer, lots.length);
    // S'assurer que infos.devis est un tableau avec assez d'elements
    if (!infos.devis || !Array.isArray(infos.devis) || infos.devis.length === 0) {
      infos.devis = [{ noDevis: '', dateDevis: '', lignesFinancieres: [] }];
    }
    while (infos.devis.length < lots.length) {
      infos.devis.push(infos.devis[infos.devis.length - 1]); // fallback : dupliquer le dernier
    }

    // Assets
    const assetsDir = path.join(__dirname, '..', 'assets');
    const ficheBytes = fs.readFileSync(path.join(assetsDir, 'fiche_attestations.pdf'));
    const cgBytes    = fs.readFileSync(path.join(assetsDir, 'conditions_generales.pdf'));
    const logoPath   = path.join(assetsDir, 'logo_legato.png');
    const logoBytes  = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

    const pdfDoc = await PDFDocument.create();
    const B = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const R = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fonts = { B, R };
    let logoImg = null;
    if (logoBytes) { try { logoImg = await pdfDoc.embedPng(logoBytes); } catch (_) {} }

    // 1. Lettre de garde commune
    await pageLettreGarde(pdfDoc, fonts, logoImg, infos, fd);

    // 2. Fiche attestations
    const fichePdf = await PDFDocument.load(ficheBytes);
    (await pdfDoc.copyPages(fichePdf, fichePdf.getPageIndices())).forEach(p => pdfDoc.addPage(p));

    // 3+. Pour chaque lot : contrat x2 exemplaires
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      const infoDevis = infos.devis[i];

      // Exemplaire 1
      await pageContratRecto(pdfDoc, fonts, logoImg, infoDevis, lot, fd);
      await pageContratVerso(pdfDoc, fonts, infoDevis, infos, lot, fd);
      // Exemplaire 2
      await pageContratRecto(pdfDoc, fonts, logoImg, infoDevis, lot, fd);
      await pageContratVerso(pdfDoc, fonts, infoDevis, infos, lot, fd);
    }

    // Conditions generales (une seule fois)
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
    res.status(500).json({ error: 'Erreur generation', detail: err.message });
  }
};
