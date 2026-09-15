/* ============================================================
   Facture+ — logique de l'application
   Structure du fichier :
     1. L'état (les données)
     2. Le rendu (afficher l'état à l'écran)
     3. Les événements (réagir à l'utilisateur)
     4. Les exports (PDF / JPEG)
     5. La sauvegarde locale + le service worker
   ============================================================ */

// -----------------------------------------------------------
// 1. L'ÉTAT
// Un seul objet contient TOUTES les données de la facture.
// Règle d'or : on modifie l'état, puis on appelle rendre().
// -----------------------------------------------------------
let facture = {
  logo: '',            // image du logo encodée en texte (data URL), ou '' si aucun
  emetteurNom: '',
  emetteurInfos: '',
  noTps: '',           // numéro d'inscription TPS
  noTvq: '',           // numéro d'inscription TVQ
  clientNom: '',
  clientInfos: '',
  numero: 'F-0001',
  date: new Date().toISOString().slice(0, 10), // format AAAA-MM-JJ
  tps: 5,
  tvq: 9.975,
  notes: '',
  lignes: [
    { description: '', quantite: 1, prix: 0 }
  ]
};

// Petit raccourci pour document.querySelector
const $ = (sel) => document.querySelector(sel);

// Formate un nombre en devise canadienne-française : 1 234,56 $
const argent = (n) =>
  new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);


// -----------------------------------------------------------
// 2. LE RENDU
// -----------------------------------------------------------

/** Calcule les totaux à partir de l'état. Fonction pure : elle ne modifie rien. */
function calculer() {
  const sousTotal = facture.lignes.reduce(
    (somme, l) => somme + (Number(l.quantite) || 0) * (Number(l.prix) || 0),
    0
  );
  const mtTps = sousTotal * (Number(facture.tps) || 0) / 100;
  const mtTvq = sousTotal * (Number(facture.tvq) || 0) / 100;
  return { sousTotal, mtTps, mtTvq, total: sousTotal + mtTps + mtTvq };
}

/** Ajuste la hauteur d'un textarea à son contenu. */
function ajusterHauteur(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}

/** Redessine les champs de lignes dans le formulaire. */
function rendreFormulaireLignes() {
  const conteneur = $('#lignes');
  conteneur.innerHTML = ''; // on vide, puis on reconstruit

  facture.lignes.forEach((ligne, index) => {
    const div = document.createElement('div');
    div.className = 'ligne';
    // La description est un <textarea> : texte libre sur plusieurs lignes.
    div.innerHTML = `
      <textarea rows="1" placeholder="Description" enterkeyhint="next" data-ligne="${index}" data-prop="description"></textarea>
      <input type="number" placeholder="Qté"  step="0.01" enterkeyhint="next" data-ligne="${index}" data-prop="quantite">
      <input type="number" placeholder="Prix" step="0.01" enterkeyhint="next" data-ligne="${index}" data-prop="prix">
      <button class="supprimer" type="button" data-supprimer="${index}" title="Supprimer">&times;</button>
    `;
    // On assigne les valeurs en JS (et non dans le HTML) pour éviter
    // tout problème de caractères spéciaux dans le texte saisi.
    const desc = div.querySelector('[data-prop="description"]');
    desc.value = ligne.description;
    div.querySelector('[data-prop="quantite"]').value = ligne.quantite;
    div.querySelector('[data-prop="prix"]').value = ligne.prix;

    conteneur.appendChild(div);
    ajusterHauteur(desc); // après insertion : scrollHeight est alors mesurable
  });
}

/** Met à jour l'aperçu de la facture (colonne de droite). */
function rendreApercu() {
  const t = calculer();

  // Logo : on l'affiche seulement s'il y en a un
  const logo = $('#p-logo');
  logo.hidden = !facture.logo;
  if (facture.logo) logo.src = facture.logo;

  $('#p-numero').textContent = facture.numero || '—';
  $('#p-date').textContent = facture.date
    ? new Date(facture.date + 'T00:00:00').toLocaleDateString('fr-CA')
    : '—';

  $('#p-emetteurNom').textContent = facture.emetteurNom || '—';
  $('#p-emetteurInfos').textContent = facture.emetteurInfos;

  // Numéros de taxes : on ne montre que ceux qui sont remplis
  $('#p-nosTaxes').textContent = [
    facture.noTps && `TPS : ${facture.noTps}`,
    facture.noTvq && `TVQ : ${facture.noTvq}`
  ].filter(Boolean).join('\n');

  $('#p-clientNom').textContent = facture.clientNom || '—';
  $('#p-clientInfos').textContent = facture.clientInfos;

  // Les lignes du tableau
  $('#p-lignes').innerHTML = facture.lignes
    .map((l) => {
      const total = (Number(l.quantite) || 0) * (Number(l.prix) || 0);
      const desc = (l.description || '—')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;'); // sécurité : on neutralise le HTML
      return `<tr>
        <td>${desc}</td>
        <td class="num">${Number(l.quantite) || 0}</td>
        <td class="num">${argent(l.prix)}</td>
        <td class="num">${argent(total)}</td>
      </tr>`;
    })
    .join('');

  $('#p-labelTps').textContent = `TPS (${facture.tps || 0} %)`;
  $('#p-labelTvq').textContent = `TVQ (${facture.tvq || 0} %)`;
  $('#p-sousTotal').textContent = argent(t.sousTotal);
  $('#p-mtTps').textContent = argent(t.mtTps);
  $('#p-mtTvq').textContent = argent(t.mtTvq);
  $('#p-total').textContent = argent(t.total);
  $('#p-notes').textContent = facture.notes;
}

/** Rendu complet + sauvegarde. */
function rendre() {
  rendreApercu();
  sauvegarder();
}


// -----------------------------------------------------------
// 3. LES ÉVÉNEMENTS
// -----------------------------------------------------------

// Champs simples : tout élément avec data-field="clé"
document.querySelectorAll('[data-field]').forEach((el) => {
  el.addEventListener('input', () => {
    facture[el.dataset.field] = el.value;
    rendre();
  });
});

// Champs de lignes : on écoute le conteneur (délégation d'événements).
// Avantage : ça marche aussi pour les lignes créées plus tard.
$('#lignes').addEventListener('input', (e) => {
  const index = e.target.dataset.ligne;
  if (index === undefined) return;
  facture.lignes[index][e.target.dataset.prop] = e.target.value;
  if (e.target.tagName === 'TEXTAREA') ajusterHauteur(e.target);
  rendre();
});

$('#lignes').addEventListener('click', (e) => {
  const index = e.target.dataset.supprimer;
  if (index === undefined) return;
  facture.lignes.splice(index, 1);            // retire la ligne
  if (facture.lignes.length === 0) ajouterLigne(false);
  rendreFormulaireLignes();
  rendre();
});

function ajouterLigne(redessiner = true) {
  facture.lignes.push({ description: '', quantite: 1, prix: 0 });
  if (redessiner) { rendreFormulaireLignes(); rendre(); }
}

$('#btn-ajouter').addEventListener('click', () => ajouterLigne());

// --- Touche « Entrée » = passer au champ suivant ---
// Sur mobile, le clavier affiche « Suivant » (enterkeyhint) au lieu de « Retour ».
// Exception : les zones de texte multilignes, où Entrée doit rester un saut de ligne.
const CHAMPS_MULTILIGNES = new Set(['emetteurInfos', 'clientInfos', 'notes']);

/** Tous les champs de saisie du formulaire, dans l'ordre du document. */
function champsSaisie() {
  return [...document.querySelectorAll('.panel [data-field], .panel [data-ligne]')];
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return; // Maj+Entrée : saut de ligne forcé

  const champ = e.target;
  const estChamp = champ.dataset.field !== undefined || champ.dataset.ligne !== undefined;
  if (!estChamp || CHAMPS_MULTILIGNES.has(champ.dataset.field)) return;

  e.preventDefault(); // empêche le saut de ligne dans les <textarea>

  const champs = champsSaisie();
  const suivant = champs[champs.indexOf(champ) + 1];
  if (!suivant) { champ.blur(); return; } // dernier champ : on ferme le clavier

  suivant.focus();
  if (suivant.tagName === 'TEXTAREA' || suivant.type === 'text' || suivant.type === 'number') {
    suivant.select();
  }
  suivant.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

// « Nouvelle facture » : on vide seulement les sections Client, Facture
// et Lignes. L'\u00e9metteur (logo, coordonn\u00e9es, num\u00e9ros de taxes), les taux
// de taxes et les notes sont conserv\u00e9s : ils changent rarement.
$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Vider les sections Client, Facture et Lignes ?\n\nVos informations d\u2019\u00e9metteur seront conserv\u00e9es.')) return;

  // Section Client
  facture.clientNom = '';
  facture.clientInfos = '';

  // Section Facture
  facture.numero = numeroSuivant(facture.numero);
  facture.date = new Date().toISOString().slice(0, 10);

  // Section Lignes : une seule ligne vide
  facture.lignes = [{ description: '', quantite: 1, prix: 0 }];

  remplirFormulaire();       // remet les champs du formulaire \u00e0 jour
  rendreFormulaireLignes();
  rendre();
});

/**
 * Incr\u00e9mente le dernier nombre trouv\u00e9 dans le num\u00e9ro de facture,
 * en conservant les z\u00e9ros de t\u00eate.  « F-0007 » devient « F-0008 ».
 * Si aucun nombre n'est trouv\u00e9, on retourne le num\u00e9ro tel quel.
 */
function numeroSuivant(numero) {
  return String(numero || '').replace(/(\d+)(?!.*\d)/, (chiffres) => {
    const suivant = String(Number(chiffres) + 1);
    // padStart rajoute les z\u00e9ros pour garder la m\u00eame longueur qu'avant
    return suivant.padStart(chiffres.length, '0');
  });
}

// --- Import du logo ---
// FileReader lit le fichier choisi et le convertit en "data URL" :
// une longue chaîne de texte (data:image/png;base64,...) qu'on peut
// mettre dans un <img src> et stocker dans localStorage.
$('#logo-input').addEventListener('change', (e) => {
  const fichier = e.target.files[0];
  if (!fichier) return;

  if (fichier.size > 1_000_000) {
    alert('Image trop lourde (max 1 Mo). Choisissez une version plus légère.');
    e.target.value = '';
    return;
  }

  const lecteur = new FileReader();
  lecteur.onload = () => {
    facture.logo = lecteur.result;
    rendreLogoFormulaire();
    rendre();
  };
  lecteur.readAsDataURL(fichier);
});

$('#logo-retirer').addEventListener('click', () => {
  facture.logo = '';
  $('#logo-input').value = '';
  rendreLogoFormulaire();
  rendre();
});

/** Affiche ou cache la vignette du logo dans le formulaire. */
function rendreLogoFormulaire() {
  const vignette = $('#logo-apercu');
  vignette.hidden = !facture.logo;
  if (facture.logo) vignette.src = facture.logo;
  $('#logo-retirer').hidden = !facture.logo;
}


// -----------------------------------------------------------
// 4. LES EXPORTS
// Principe : html2canvas « photographie » le bloc #facture
// et nous rend un <canvas>. Ensuite :
//   - JPEG : on télécharge directement l'image du canvas
//   - PDF  : on colle cette image dans une page A4 avec jsPDF
// -----------------------------------------------------------

function nomFichier(extension) {
  const nom = (facture.numero || 'facture').replace(/[^\w-]/g, '_');
  return `${nom}.${extension}`;
}

/** Transforme #facture en canvas haute résolution. */
async function capturer() {
  return html2canvas($('#facture'), {
    scale: 2,             // x2 = rendu net (rétine / impression)
    backgroundColor: '#ffffff',
    useCORS: true
  });
}

/** Construit le PDF et le retourne sous forme de Blob (fichier en mémoire). */
async function construirePdf() {
  const canvas = await capturer();
  const image = canvas.toDataURL('image/jpeg', 0.95);

  // jsPDF est exposé dans window.jspdf par la version UMD
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const largeurPage = 210;
  // On garde les proportions de l'image capturée
  const hauteurImage = (canvas.height / canvas.width) * largeurPage;

  pdf.addImage(image, 'JPEG', 0, 0, largeurPage, hauteurImage);
  return pdf.output('blob');
}

/** Construit le JPEG et le retourne sous forme de Blob. */
async function construireJpeg() {
  const canvas = await capturer();
  return new Promise((resoudre) => canvas.toBlob(resoudre, 'image/jpeg', 0.95));
}

/** Déclenche le téléchargement d'un Blob. */
function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  a.click();
  URL.revokeObjectURL(url); // on libère la mémoire
}

$('#btn-jpeg').addEventListener('click', async () => {
  telecharger(await construireJpeg(), nomFichier('jpg'));
});

$('#btn-pdf').addEventListener('click', async () => {
  telecharger(await construirePdf(), nomFichier('pdf'));
});

// --- Partage natif ---
// navigator.share ouvre le menu de partage du téléphone
// (courriel, Messenger, AirDrop, WhatsApp…).
// Disponible seulement en HTTPS et surtout sur mobile.
$('#btn-partager').addEventListener('click', async () => {
  const blob = await construirePdf();
  const fichier = new File([blob], nomFichier('pdf'), { type: 'application/pdf' });

  // canShare vérifie que l'appareil accepte de partager des fichiers
  if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
    try {
      // Pas de propriété `text` : elle remplirait le corps du courriel.
      // `title` sert uniquement d'objet du message.
      await navigator.share({
        files: [fichier],
        title: `Facture ${facture.numero}`
      });
    } catch (err) {
      // L'utilisateur a fermé le menu : ce n'est pas une erreur.
      if (err.name !== 'AbortError') console.warn('Partage échoué :', err);
    }
    return;
  }

  // Solution de repli (ordinateur de bureau) : on télécharge le fichier.
  alert("Le partage n'est pas disponible sur cet appareil. Le PDF va être téléchargé.");
  telecharger(blob, nomFichier('pdf'));
});


// -----------------------------------------------------------
// 5. SAUVEGARDE LOCALE + SERVICE WORKER
// -----------------------------------------------------------

const CLE_SAUVEGARDE = 'facture-plus';

/** localStorage ne stocke que du texte : on sérialise en JSON. */
function sauvegarder() {
  localStorage.setItem(CLE_SAUVEGARDE, JSON.stringify(facture));
}

function charger() {
  // 'factureflash' : ancienne clé, conservée pour ne pas perdre les données existantes.
  const brut = localStorage.getItem(CLE_SAUVEGARDE) || localStorage.getItem('factureflash');
  if (!brut) return;
  try {
    facture = { ...facture, ...JSON.parse(brut) };
  } catch (e) {
    console.warn('Sauvegarde illisible, on repart à neuf.', e);
  }
}

/** Remplit les champs du formulaire avec l'état chargé. */
function remplirFormulaire() {
  document.querySelectorAll('[data-field]').forEach((el) => {
    el.value = facture[el.dataset.field] ?? '';
  });
}

// Démarrage
charger();
remplirFormulaire();
rendreLogoFormulaire();
rendreFormulaireLignes();
rendre();

// Le service worker rend l'app installable et utilisable hors-ligne.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .catch((err) => console.warn('Service worker non enregistré :', err));
  });
}
