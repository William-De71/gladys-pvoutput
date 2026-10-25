# PVOutput

## Présentation

Cette intégration amène dans Gladys les installations solaires de votre compte [PVOutput](https://pvoutput.org), et permet à vos scènes d’envoyer des données à PVOutput. PVOutput.org est un service gratuit où les propriétaires d’installations solaires partagent et comparent leur production ; l’intégration utilise son API officielle avec votre propre clé, et n’est pas affiliée à PVOutput.

- Un appareil par système (jusqu’à cinq) : puissance produite, énergie produite du jour, production totale et — quand le système les publie — puissance et énergie consommées du jour, température et tension.
- Deux widgets : le système aujourd’hui (avec la courbe du jour) et ses 30 derniers jours.
- Déclencheurs de scène : système silencieux en journée, retour du système, bilan du jour après le coucher du soleil, journée record, clé refusée.
- Actions de scène : envoyer un statut en direct, envoyer la production d’un jour, lire la journée d’un système.

Transport : cloud. Votre clé d’API, vos System Id et les valeurs envoyées par vos scènes partent vers `pvoutput.org` ; rien d’autre ne quitte Gladys.

## Prérequis

- Gladys Assistant 5.3.0 ou plus récent.
- Un compte PVOutput (gratuit) avec l’accès à l’API activé.
- **La clé d’API** : sur pvoutput.org, ouvrez **Settings**, passez **API Access** sur **Enabled**, cliquez sur **New Key**, puis **Save**. Une _clé en lecture seule_ (read only key) suffit pour lire vos systèmes ; envoyer des statuts ou des productions depuis les scènes demande la _clé standard_.
- **Le System Id** de chaque système : en bas de la page Settings, sous **Registered Systems**.

Le quota : PVOutput accepte **60 requêtes par heure et par clé** (300 en mode donation), tous les systèmes et toutes les applications qui utilisent la clé ensemble. L’intégration reste dessous d’elle-même, garde 15 requêtes par heure (60 en mode donation) pour vos scènes, et se met en pause jusqu’à l’heure suivante quand PVOutput indique que le quota est épuisé. Chaque statut envoyé par une scène est une requête : une scène toutes les 5 minutes consomme 12 requêtes par heure.

## Configuration

| Champ             | Rôle                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Clé d’API         | La clé de Settings → API Access (secrète, jamais réaffichée ni écrite dans les journaux)              |
| System Id(s)      | Un System Id, ou plusieurs séparés par des virgules (cinq au plus), du même compte                    |
| Mode donation     | À cocher si votre compte est en mode donation (300 requêtes par heure)                                |
| Langue des textes | Noms des fonctionnalités, textes et erreurs des scènes ; automatique suit la langue du dernier widget |

Appuyez ensuite sur **Tester la connexion** : il affiche pour chaque système son nom, sa puissance, son intervalle de statut, son fuseau horaire, et les requêtes restantes de l’heure. **Diagnostic** écrit l’état de l’intégration dans ses journaux, sans la clé.

## Utilisation

### Appareils

Ouvrez **Découverte** et ajoutez vos systèmes. Chaque appareil a :

- **Production solaire** (W) : le dernier statut, 0 la nuit ; un système en retard en journée garde sa dernière valeur ;
- **Production du jour** (kWh) et **Production totale** (kWh, un index pour l’historique : il n’alimente jamais la consommation ni le coût dans Gladys) ;
- quand le système les publie : **Consommation** (W), **Consommation du jour** (kWh), **Température** (°C, hors moyenne de la pièce), **Tension** (V).

Une fonctionnalité apparaît la première fois que PVOutput lui donne une valeur, et ne disparaît jamais. Les lectures suivent l’intervalle de statut de chaque système (5 à 15 minutes) en journée et toutes les 30 minutes la nuit, et s’allongent quand vous suivez plusieurs systèmes.

### Widgets du tableau de bord

![Les deux widgets : un système aujourd’hui avec sa courbe de puissance, et ses 30 derniers jours en barres (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-pvoutput/main/docs/assets/widgets.fr.png)

- **PVOutput aujourd’hui** : puissance actuelle, énergie du jour, consommation ou injection, rendement (kWh/kWc), courbe du jour avec son pic, heure du dernier statut (ou silencieux, ou nuit) et requêtes restantes de l’heure. La courbe n’est lue que lorsque le widget est affiché.
- **PVOutput, 30 jours** : les 30 derniers jours en barres, le total du mois, le meilleur jour, la moyenne, le record de rendement et sa date, la production totale.

Choisissez le système dans les réglages du widget (vide : le premier).

### Scènes

Déclencheurs :

- **PVOutput : système silencieux** : aucun nouveau statut pendant 3 intervalles de statut (30 minutes au moins) alors que le soleil est levé au système. Jamais la nuit : les onduleurs ne publient rien. **PVOutput : retour du système** : il publie de nouveau.
- **PVOutput : bilan du jour** : une fois par jour, environ une heure après le coucher du soleil au système, avec la production, l’injection, la consommation, le pic, le rendement et une phrase (`summary`).
- **PVOutput : journée record** : le rendement du jour est le record de la vie du système.
- **PVOutput : clé refusée** : PVOutput refuse la clé.

Actions :

- **PVOutput : envoyer un statut** : les valeurs sont des champs texte qui acceptent les variables `{{…}}` des actions précédentes (par exemple « récupérer la dernière valeur d’un appareil »). Énergies en kWh (ou Wh, choisi dans l’action ou écrit après la valeur), puissances en W. « Valeurs cumulées » indique qu’une énergie est un index depuis l’origine ; « Données nettes » envoie les puissances d’injection et de soutirage d’un compteur. Date et heure : maintenant, dans le fuseau du système.
- **PVOutput : envoyer la production d’un jour** : aujourd’hui ou hier ; production, injection, consommation, soutirage heures pleines et creuses en kWh (ou écrits en Wh, `6210 Wh`), températures `min / max`, condition, commentaire.
- **PVOutput : lire la journée d’un système** : production, injection, consommation, pic, rendement, puissance actuelle, dernier statut et une phrase, sans aucune requête.

Exemples :

1. Toutes les 5 minutes → récupérer la dernière valeur de la puissance de l’onduleur et de son index de production → **PVOutput : envoyer un statut** avec la puissance `{{…}}`, l’énergie `{{…}}` et « La production est un index ».
2. Chaque soir à 23 h 30 → récupérer les valeurs Linky du jour → **PVOutput : envoyer la production d’un jour** avec l’injection et le soutirage.
3. Quand **PVOutput : système silencieux** → envoyer une notification « L’onduleur est muet depuis {{triggerEvent.data.last_status_time}} ».
4. Quand **PVOutput : bilan du jour** → envoyer le message « Aujourd’hui : {{triggerEvent.data.production_kwh}} kWh ».

## Dépannage

- **« PVOutput refuse la clé d’API »** : vérifiez la clé dans Settings → API Access, et qu’API Access est sur _Enabled_. Une nouvelle clé remplace l’ancienne.
- **« PVOutput ne connaît pas le System Id »** : le System Id est un nombre sous Registered Systems, pour un système du compte de la clé.
- **« La clé est une clé en lecture seule »** : la lecture fonctionne, l’envoi demande la clé standard.
- **« Lectures en pause jusqu’à… »** : les requêtes de l’heure sont épuisées, souvent parce qu’une autre application utilise la même clé. Elles reprennent à l’heure suivante ; vos scènes gardent une réserve.
- **« Moon Powered »** à l’envoi : PVOutput pense qu’il fait nuit au système : vérifiez le fuseau horaire du système sur PVOutput.
- **Une énergie « trop élevée »** : la valeur est sans doute en Wh alors que l’action attend des kWh (ou un index sans « Valeurs cumulées »).
- **Pas de courbe dans le widget** : elle arrive avec la lecture suivante une fois le widget affiché (quelques minutes).
- Signalez un problème sur GitHub avec les versions de Gladys et de l’intégration, le message de **Tester la connexion** et les lignes écrites par **Diagnostic**. Ne collez jamais votre clé.
