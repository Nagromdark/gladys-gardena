# GARDENA smart system

Pilotez votre jardin GARDENA depuis Gladys : tondeuses robots, vannes
d'arrosage, prises d'extérieur et capteurs de sol. L'intégration utilise l'**API
publique officielle GARDENA smart system**, celle qu'utilise l'application
GARDENA elle-même : tout reste synchronisé dans les deux sens.

## Ce dont vous avez besoin

- une **passerelle GARDENA smart gateway** déjà installée, avec vos appareils
  appairés et fonctionnels dans l'application GARDENA ;
- un compte gratuit sur le **portail développeur Husqvarna** (GARDENA appartient
  au groupe Husqvarna) — l'API est gratuite pour un usage personnel.

L'intégration ne parle jamais directement à vos appareils : les appareils
GARDENA utilisent une radio propriétaire vers la passerelle, et la passerelle ne
parle qu'au cloud GARDENA. Une connexion Internet est donc nécessaire.

## Étape 1 — Créer votre application d'API

1. Rendez-vous sur <https://developer.husqvarnagroup.cloud/> et cliquez sur
   **Sign in**.
2. Connectez-vous avec **votre compte GARDENA habituel** (celui de
   l'application GARDENA). Aucun compte séparé n'est à créer.
3. Ouvrez **My applications** puis cliquez sur **New application**. Donnez-lui
   le nom que vous voulez, par exemple `Gladys`. L'URL de redirection n'est pas
   utilisée par cette intégration : laissez-la vide ou mettez
   `http://localhost`.
4. Sur la page de l'application, cliquez sur **Connect new API** et connectez
   l'**API GARDENA smart system**. Cette étape est facile à oublier, et sans
   elle l'API répond `403 Forbidden` à toutes les requêtes.
5. Copiez la **Application key** (clé) et l'**Application secret** (secret)
   affichés sur cette page.

> Laissez également l'API d'authentification connectée — elle est ajoutée
> automatiquement dans la plupart des cas, et c'est elle qui délivre le jeton.

## Étape 2 — Configurer l'intégration dans Gladys

1. Collez la **clé d'application** et le **secret d'application** dans l'écran
   de configuration, puis enregistrez.
2. Cliquez sur **Tester la connexion** : l'intégration s'authentifie et liste
   les emplacements (jardins) de votre compte.
3. Allez dans l'onglet **Découvrir** : tous les appareils GARDENA de votre
   compte apparaissent. Créez ceux que vous souhaitez utiliser dans Gladys.

Réglages optionnels :

| Réglage                        | Rôle                                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifiant d'emplacement**  | Limiter l'intégration à un seul jardin. Laissez vide pour tous les utiliser.                                                                                                                                                             |
| **Relecture de l'API GARDENA** | Délai minimum entre deux relectures complètes de l'API GARDENA, le filet de sécurité derrière le flux temps réel. C'est ce réglage qui consomme votre quota hebdomadaire de requêtes — voir le tableau plus bas. Par défaut : une heure. |
| **Durée par défaut**           | Durée d'arrosage d'une vanne, ou d'allumage d'une prise, quand vous l'activez depuis Gladys.                                                                                                                                             |
| **Allumage des prises**        | Éteindre automatiquement après la durée par défaut, ou rester allumée jusqu'à extinction.                                                                                                                                                |
| **Démarrage de la tondeuse**   | Démarrer la tondeuse peut suivre son propre calendrier, ou le forcer pendant une durée fixe.                                                                                                                                             |
| **Arrêt de la tondeuse**       | Arrêter la tondeuse peut la garer jusqu'à sa prochaine tâche planifiée, ou annuler le calendrier jusqu'à nouvel ordre.                                                                                                                   |

## Ce que vous obtenez dans Gladys

| Appareil GARDENA                 | Fonctionnalités créées                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| smart Mower (SILENO...)          | Tonte (marche/arrêt), activité, état, dernière erreur, heures de fonctionnement, batterie, signal  |
| smart Water Control              | Arrosage (marche/arrêt), activité, temps d'arrosage restant, batterie, signal                      |
| smart Irrigation Control         | Un interrupteur d'arrosage, une activité et un temps restant **par voie**, nommés comme dans l'app |
| smart Power (prise d'extérieur)  | Marche/Arrêt, activité, temps restant, signal                                                      |
| smart Sensor / smart Soil Sensor | Humidité du sol, température du sol, température ambiante, luminosité, batterie, signal            |

Activer une vanne lance un **arrosage manuel de la durée configurée** : l'API
GARDENA ne propose pas de commande « ouvrir indéfiniment » sur une vanne, ce qui
est exactement ce que l'on veut d'un système domotique branché sur un robinet.

L'état marche/arrêt d'une tondeuse, d'une vanne ou d'une prise reflète toujours
ce que GARDENA rapporte, et non ce que Gladys a demandé : une tondeuse rentrée à
cause de la pluie, ou une vanne ouverte depuis l'application GARDENA, s'affiche
correctement dans Gladys.

## Temps réel

L'intégration maintient un websocket ouvert vers GARDENA pour chaque
emplacement, la méthode supportée pour suivre un jardin : un changement fait sur
l'appareil, dans l'application GARDENA ou par une programmation arrive dans
Gladys en une à deux secondes. Le rafraîchissement périodique n'est qu'un filet
de sécurité en cas de message manqué.

GARDENA ferme ce websocket toutes les deux heures environ, volontairement :
l'intégration se reconnecte seule et se resynchronise à chaque fois.

Gladys interroge ses appareils toutes les minutes (son intervalle le plus court
disponible), mais cette interrogation **n'appelle pas** GARDENA : l'intégration
répond depuis l'image qu'elle a déjà en mémoire, et ne relit l'API GARDENA que
lorsque cette image dépasse l'âge du réglage **Relecture de l'API GARDENA**.
Quel que soit le nombre d'appareils du jardin, une relecture coûte un appel.

## Widgets du tableau de bord

Deux cartes peuvent être ajoutées à n'importe quel tableau de bord Gladys,
depuis le sélecteur de blocs.

**Arrosage GARDENA** affiche une ligne par sortie d'eau et pour la prise — ce
qui est ouvert en ce moment, en clair — avec des tuiles d'humidité du sol, un
bouton **Arrêter l'arrosage** qui ferme toutes les vannes du compte d'un coup,
un formulaire **Arroser…** pour ouvrir une sortie pendant une durée choisie, et
un bouton pour allumer ou éteindre la prise.

**Tondeuse GARDENA** affiche l'activité, l'état et la dernière erreur de la
tondeuse, sa batterie et ses heures de tonte, avec **Tondre** / **Rentrer**, un
formulaire **Tondre…**, et **Garer, sans calendrier** (qui demande une
confirmation, puisqu'il annule le calendrier jusqu'à ce que vous la relanciez).

Chaque carte a un réglage optionnel : quel capteur alimente les tuiles, et
quelle tondeuse les boutons pilotent. Laissez-les vides si votre jardin n'en a
qu'un — ils existent pour les jardins qui en ont plusieurs, où agir sur « le
premier » serait une devinette. Posez deux cartes d'arrosage, chacune liée à un
capteur, et vous obtenez un jeu de tuiles par zone.

**Afficher un widget n'appelle jamais l'API GARDENA.** Les cartes se contentent
de l'image que le flux temps réel garde déjà en mémoire : un tableau de bord
laissé ouvert toute la journée ne coûte rien à votre quota hebdomadaire. Seul un
appui sur un bouton d'action envoie une requête — une par commande, exactement
comme un interrupteur sur une page d'appareil.

Les tuiles liées à un capteur se mettent à jour seules, en direct. Le reste de
la carte est rechargé quand quelque chose change vraiment, au plus une fois
toutes les dix secondes.

## Rester dans le quota de requêtes GARDENA

GARDENA accorde un **nombre limité de requêtes API par semaine** à une
application personnelle gratuite. L'intégration est construite autour de cette
contrainte : le websocket temps réel ne coûte rien par événement, si bien que
les requêtes consommées sont presque uniquement celles de la relecture
périodique de sécurité.

Ce que coûte une semaine, quel que soit le nombre d'appareils du jardin (une
relecture lit tout l'emplacement en un seul appel) :

| Relecture de l'API GARDENA | Relectures | URL websocket | Jetons | **Total / semaine** |
| -------------------------- | ---------- | ------------- | ------ | ------------------- |
| 15 minutes                 | 672        | 84            | 7      | **763**             |
| 30 minutes                 | 336        | 84            | 7      | **427**             |
| **1 heure (par défaut)**   | **168**    | **84**        | **7**  | **259**             |
| 2 heures                   | 84         | 84            | 7      | **175**             |
| 6 heures                   | 28         | 84            | 7      | **119**             |

Les deux coûts fixes sont incompressibles : GARDENA ferme le flux temps réel
toutes les deux heures environ et il faut redemander une URL (~84 par semaine),
et le jeton d'accès est renouvelé chaque jour (7 par semaine, sur l'API
d'authentification, distincte).

Les commandes ajoutent une requête chacune — ouvrir une vanne, allumer une
prise, démarrer la tondeuse. Cent commandes par semaine, cent requêtes : avec la
relecture par défaut, la marge reste large.

Deux réflexes suffisent :

- **ne descendez pas la relecture sous une heure** sans savoir que votre quota
  le permet. Le flux temps réel apporte déjà tous les changements en quelques
  secondes ; la relecture ne rattrape que ce qu'un websocket coupé aurait pu
  manquer ;
- **évitez de redémarrer l'intégration en boucle** : chaque démarrage coûte un
  listing des emplacements plus une relecture complète.

Si GARDENA répond malgré tout « trop de requêtes », l'intégration **suspend
d'elle-même ses relectures REST pendant une heure** et continue de fonctionner
sur le flux temps réel, au lieu d'insister et d'aggraver la situation.

## Actions

- **Tester la connexion** — s'authentifie et liste les emplacements du compte.
  À utiliser en premier lorsque quelque chose ne va pas.
- **Rafraîchir les appareils** — relit le compte, par exemple après avoir ajouté
  un appareil dans l'application GARDENA.
- **Arrêter tout l'arrosage** — ferme toutes les vannes de l'appareil choisi
  jusqu'à sa prochaine tâche planifiée. Pratique dans une scène, ou avant
  d'aller marcher dans le jardin.

## En cas de problème

**« GARDENA a refusé les identifiants »** — la clé ou le secret est incorrect,
ou bien l'**API GARDENA smart system n'est pas connectée à votre application**
sur le portail développeur (étape 1.4). C'est de loin la cause la plus
fréquente.

**Un appareil affiche un badge orange « injoignable »** — la passerelle GARDENA
ne le voit plus (liaison radio hors ligne) : l'appareil est hors de portée,
éteint, ou ses piles sont vides. Gladys conserve les dernières valeurs connues
au lieu de faire croire qu'elles sont à jour.

**« GARDENA limite le débit de l'intégration »** — l'API applique sa limitation.
L'intégration espace ses appels et réessaie, mais si vous avez beaucoup augmenté
la fréquence de rafraîchissement, remettez une valeur plus élevée : le flux
temps réel vous donne déjà les changements.

**Aucun appareil dans l'onglet Découvrir** — vérifiez que vos appareils
apparaissent bien dans l'application GARDENA, et que le filtre d'emplacement (si
vous en avez mis un) correspond au bon jardin.

**Un widget affiche « Connexion à votre compte GARDENA… »** — l'intégration
démarre ou se reconnecte. Si cela persiste, utilisez **Tester la connexion**
dans la configuration : la carte signale simplement que le jardin n'est pas
encore chargé.

**Un widget affiche les valeurs mais aucun bouton marche/arrêt** — les boutons
qui agissent sur un appareil n'apparaissent qu'une fois cet appareil créé dans
Gladys, depuis l'onglet **Découvrir**. Les boutons **Arrêter l'arrosage**,
**Arroser…** et **Tondre…** n'en ont pas besoin.

---

_GARDENA est une marque déposée du groupe Husqvarna. Cette intégration
communautaire est indépendante : elle n'est ni affiliée à GARDENA ou au groupe
Husqvarna, ni approuvée ou supportée par eux._
