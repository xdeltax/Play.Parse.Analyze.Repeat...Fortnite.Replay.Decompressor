# Fortnite Replay Data Reference

This document describes everything the **Fortnite Replay Decompressor** can extract from `.replay` files.
Data comes from two sources:

- **Event Chunks** – Binary-encoded match events at fixed offsets (fast, encrypted, owner-only stats)
- **Network Chunks** – The UE5 NetSerialize replication stream (full server replication data, all players)

All examples below are taken from a real `Playlist_DefaultSquad` replay (`C7S3 SoloVsSquads-2026.06.20-12.11.41`).

---

## 1. Replay Metadata (`Info` + `Header`)

Basic metadata is stored in the replay file header — no network parsing needed.

| Field | Type | Example Value | Description |
|---|---|---|---|
| `Info.LengthInMs` | `int` | `1382549` | Total replay duration in milliseconds (→ 23:02 min) |
| `Info.Timestamp` | `DateTime` | `2026-06-20T12:11:41` | Local time the match started |
| `Info.IsLive` | `bool` | `false` | Whether the replay is still being recorded |
| `Info.IsCompressed` | `bool` | `true` | Whether the replay data is compressed |
| `Info.IsEncrypted` | `bool` | `true` | Whether the replay data is AES-encrypted |
| `Info.EncryptionKey` | `string` | `a89Bph9O...` | Base64-encoded AES-128 key (needed to decrypt) |
| `Info.NetworkVersion` | `uint` | `3854969903` | Network protocol version |
| `Info.Changelist` | `int` | `55159917` | Build changelist number |
| `Header.Branch` | `string` | `++Fortnite+Release-41.00` | Game version branch → **v41.00** |
| `Header.Guid` | `string` | `A8BE5BF5A9C3F448...` | Unique replay GUID |
| `Header.UE5Version` | `int` | `1018` | Unreal Engine 5 version |
| `Header.Platform` | `string` | `WindowsClient` | Platform the recording client ran on |
| `Header.GameSpecificData` | `string[]` | `VerseURI=...`, `SubGame=Athena` | Epic-internal meta flags |

> **Game Version** is automatically extracted from `Branch` using a regex → `v41.00`

---

## 2. Match / Session Info (`GameData`)

Parsed from the `Athena_GameState_C` actor replicated at match start.

| Field | Type | Example Value | Description |
|---|---|---|---|
| `GameSessionId` | `string` | `8752356b73da4bb6a16e1e8ea8e01743` | Unique server session ID (useful for deduplication) |
| `UtcTimeStartedMatch` | `DateTime?` | `2026-06-20T10:11:39.376Z` | UTC time the match was initiated on the server |
| `MatchEndTime` | `float?` | `1392.17` | Server-time (seconds) when the match ended |
| `CurrentPlaylist` | `string` | `Playlist_DefaultSquad` | Playlist identifier → used to derive **SQUADS / SOLO / DUOS / TRIOS** |
| `MaxPlayers` | `int?` | `100` | Max lobby size |
| `TeamSize` | `int?` | `4` (= Squads) | Players per team (1=Solo, 2=Duos, 3=Trios, 4=Squads) |
| `TotalPlayerStructures` | `int?` | `1` | Total structures built in the match |
| `WinningTeam` | `uint?` | `3` | TeamIndex of the winning team |
| `WinningPlayerIds` | `IEnumerable<int>` | `[262]` | Actor IDs of winning players |
| `ActiveGameplayModifiers` | `IList<string>` | `MaterialDropOnElim_Default`, `GameplayMod_Phoebe_DM`, ... | Active gameplay rule modifiers (e.g. which AI types, loot rules) |
| `RecorderId` | `uint?` | `876` | Actor ID of the player who recorded the replay |
| `IsLargeTeamGame` | `bool?` | `null` | Set for modes like 50v50 |
| `IsTournamentRound` | `bool` | `false` | Whether this was a tournament match |
| `WarmupCountdownEndTime` | `float?` | *(varies)* | When warmup ended (used as time offset for killfeed) |
| `AircraftStartTime` | `float?` | *(varies)* | When the Battle Bus started flying |
| `SafeZonesStartTime` | `float?` | *(varies)* | When the storm started moving |

> **Gameplay Modifiers** tell you which server-side rules were active. In this replay:
> - `GameplayMod_Phoebe_DM` = Fortnite Chapter 7 (Phoebe build) game mode module
> - `GameplayMod_DeimosAI` = AI/NPC rules for the Deimos AI system
> - `MaterialDropOnElim_Default` = materials drop on kill (loot rule)
> - `Rufus_SafeZoneBlacklist_Modifier` = storm blacklist modifier

---

## 3. Player Data (`PlayerData`)

Each player seen in the match has a `PlayerData` object built from their replicated `FortPlayerStateAthena`.

### 3a. Identity

| Field | Type | Example Value | Description |
|---|---|---|---|
| `PlayerName` | `string?` | `xdx2k7` | Display name seen in-game |
| `EpicId` | `string?` | `634311A416164074906752232C0DC6D2` | Epic Games account UUID |
| `PlatformUniqueNetId` | `string?` | `7163C402CE9D4202...` | Platform-specific network ID (PSN, XBL, etc.) |
| `BotId` | `string?` | `AB373B693BC14EE2...` | Identifier only set for AI bots |
| `IsBot` | `bool` | `true`/`false` | `true` for both named bots and unnamed NPCs |
| `IsReplayOwner` | `bool` | `true` (only one) | The player who recorded this replay file |
| `IsPartyLeader` | `bool` | `true`/`false` | Whether they led their party |
| `Platform` | `string` | `WIN`, `PS5`, `XSX`, `PSN`, `XBL` | Platform of the player |
| `IsUsingStreamerMode` | `bool?` | `null`/`true` | Whether name is hidden via streamer mode |
| `IsUsingAnonymousMode` | `bool?` | `null`/`true` | Whether the player used anonymous mode |

> **Bot detection**: Named bots have a `BotId` set; unnamed NPCs have `IsBot=true` but `BotId=null`. Fortnite can have **both** types in the same match.

### 3b. Progression & Team

| Field | Type | Example Value | Description |
|---|---|---|---|
| `Level` | `int?` | `29` | Account level (progression) |
| `SeasonLevelUIDisplay` | `uint?` | `29` | Season-specific level shown in the HUD |
| `TeamIndex` | `int?` | `3` | Team number (used to group teammates: `[T03]`) |
| `IsGameSessionOwner` | `bool?` | `null`/`true` | Match host / session owner |

### 3c. Combat & Placement

| Field | Type | Example Value | Description |
|---|---|---|---|
| `Placement` | `int?` | `1` | Final finish placement (1 = winner) |
| `Kills` | `uint?` | `6` | Number of eliminations |
| `TeamKills` | `uint?` | `6` | Total team kill score |
| `HasCrown` | `bool` | `true` | Whether the player had a Victory Crown |
| `RebootCounter` | `uint?` | `null` | How many times this player was rebooted |
| `Disconnected` | `bool?` | `true`/`null` | Whether the player disconnected mid-match |

### 3d. Death Info

| Field | Type | Example Value | Description |
|---|---|---|---|
| `DeathTimeDouble` | `double?` | `924.94` | Server time (seconds) of death — high precision |
| `DeathTime` | `float?` | *(fallback)* | Older float fallback for death time |
| `DeathCause` | `int?` | `5` | Enum: cause of death (`5` = weapon kill, `4` = knocked, `17` = storm) |
| `DeathCircumstance` | `int?` | `null` | Additional circumstance enum |
| `DeathTags` | `IEnumerable<string>?` | `["Weapon.Ranged.SMG", "Rarity.Uncommon", "skill.sniper.headshotbuff", ...]` | **Full gameplay tag list at time of death** — encodes weapon type, buffs, location state, status effects |
| `DeathLocation` | `FVector?` | `{X: 10831, Y: -37771, Z: 4317}` | 3D world position where the player died (in Unreal Units) |

> **DeathTags are very rich**: They contain the weapon type, mods (suppressor, laser, foregrip), movement state, active buffs, POI state, skin material, and more. The analyzer uses them to extract a human-readable weapon name (e.g. `"SMG: DragonCart"`, `"Assault: SunRose"`, `"Storm"`).

**Known `DeathCause` enum values:**

| Value | Meaning |
|---|---|
| `4` | Knocked (DBNO) |
| `5` | Weapon elimination |
| `17` | Storm / outside safe zone |

### 3e. Status Flags

| Field | Type | Example Value | Description |
|---|---|---|---|
| `HasFinishedLoading` | `bool?` | `true` | Player finished loading into the match |
| `HasStartedPlaying` | `bool?` | `true` | Player has entered the game world |
| `HasThankedBusDriver` | `bool?` | `true` | Thanked the bus driver (social interaction) |
| `InventoryId` | `uint?` | *(actor ID)* | Actor ID of the player's inventory |
| `CurrentWeapon` | `uint?` | `33560` | Actor ID of the weapon currently held at replay snapshot |

---

## 4. Player Cosmetics (`PlayerData.Cosmetics`)

Cosmetics are replicated from both `FortPlayerStateAthena` and the `PlayerPawn` actor.

| Field | Type | Example Value | Description |
|---|---|---|---|
| `Character` | `string` | `CID_206_Athena_Commando_M_Bling` | Skin asset name (→ abbreviated to `Bling` in output) |
| `Backpack` | `string?` | `null` | Back bling asset name |
| `Pickaxe` | `string` | `Pickaxe_ID_014_WinterCamo` | Harvesting tool asset |
| `Glider` | `string` | `Umbrella_MatteBlack` | Glider / parachute asset |
| `SkyDiveContrail` | `string` | `DefaultContrail` | Trail shown while skydiving |
| `MusicPack` | `string?` | `null` | Music pack asset |
| `PetSkin` | `string?` | `null` | Pet asset |
| `Dances` | `IEnumerable<string>` | `[null, null, ...]` | Up to 8 emote/dance slots |
| `ItemWraps` | `IEnumerable<string>` | `[null, null, ...]` | Up to 7 weapon wrap slots |
| `LoadingScreen` | `string` | `LoadingScreen_Rufus_KeyArt` | Loading screen asset |
| `BannerIconId` | `string` | `BRS12_Prestige5` | Banner icon asset ID |
| `BannerColorId` | `string` | `DefaultColor22` | Banner color ID |
| `HeroType` | `string?` | `null` | Hero type (body model type) |
| `CharacterGender` | `int?` | `null` | Gender enum (0=Female, 1=Male) |
| `CharacterBodyType` | `int?` | `null` | Body type enum |
| `IsDefaultCharacter` | `bool?` | `null` | Whether using the default/starter skin |

> The analyzer strips the long `CID_XXX_Athena_Commando_M_` prefix automatically, showing only the unique skin name part (e.g. `Bling`, `BrightBomberMint`, `GolfSummer`).

---

## 5. Player Movement History (`PlayerData.Locations`)

Each network-replicated movement update per player is stored as a `PlayerMovement` entry.

> **Note**: In `ParseMode.Minimal` (production/release mode), movement locations are **not stored** to keep memory usage low. They are available when using `ParseMode.Full` or `ParseMode.Normal`.

| Field | Type | Description |
|---|---|---|
| `ReplicatedMovement` | `FRepMovement?` | Full physics state: position (X/Y/Z), rotation (Pitch/Yaw/Roll), velocity vector |
| `ReplicatedWorldTimeSeconds` | `float?` | Timestamp of this update (server seconds) |
| `ReplicatedWorldTimeSecondsDouble` | `double?` | High-precision timestamp |
| `bIsCrouched` | `bool?` | Player is crouching |
| `bIsSprinting` | `bool?` | Player is auto-sprinting / sprint-locked |
| `bIsJumping` | `bool?` | Jump is in progress |
| `bIsSlopeSliding` | `bool?` | Player is slope-sliding |
| `bIsZiplining` | `bool?` | Player is on a zipline |
| `bIsTargeting` | `bool?` | Player is ADS (aiming down sights) |
| `bIsDBNO` | `bool?` | Player is knocked (downed-but-not-out) |
| `bIsHonking` | `bool?` | Player is in a vehicle and honking |
| `bIsInAnyStorm` | `bool?` | Player is inside the storm |
| `bIsWaitingForEmoteInteraction` | `bool?` | Waiting for partner in a group emote |
| `bIsPlayingEmote` | `bool?` | Currently emoting |
| `bIsSkydiving` | `bool?` | In free-fall after jumping from the bus |
| `bIsSkydivingFromBus` | `bool?` | Specifically jumped from Battle Bus |
| `bIsSkydivingFromLaunchPad` | `bool?` | Jumped from a launch pad |
| `bIsParachuteOpen` | `bool?` | Glider is deployed |
| `bIsParachuteForcedOpen` | `bool?` | Glider was force-deployed (near ground) |
| `bIsInWaterVolume` | `bool?` | Player is in water |

---

## 6. Sprint / Tactical Sprint Mechanic

The **Sprint** (Chapter 3) and **Tactical Sprint** (Chapter 4 Season 1+) mechanics are both present in the replay network data.

| Field | Location | Description |
|---|---|---|
| `bIsSprinting` | `PlayerPawn` + `PlayerMovement` | `true` while auto-sprinting / sprint-locked |
| `bIsTacticalSprinting` | `PlayerPawn` | `true` during **Tactical Sprint** (the stamina-bar sprint) |
| `bIsWaterSprintBoost` | `PlayerPawn` | Water sprint boost is active |
| `bIsWaterSprintBoostPending` | `PlayerPawn` | Water sprint boost is queued |
| `SprintSpeed` | `PlayerPawn` | Replicated sprint movement speed (Unreal Units/sec) |
| `CrouchedSprintSpeed` | `PlayerPawn` | Sprint speed while crouching |

> ✅ `bIsTacticalSprinting` = the dedicated tactical sprint flag (Chapter 4+ sprint with stamina).
> ❌ The **stamina bar value itself** is client-predicted and not replicated to other clients.

---

## 7. Kill Feed (`KillFeedEntry`)

The Kill Feed is built from `FortPlayerStateAthena` replication events. It is **much richer** than the event-chunk `Eliminations` list.

| Field | Type | Example Value | Description |
|---|---|---|---|
| `PlayerId` | `int?` | `262` | Actor ID of the **victim** |
| `PlayerName` | `string?` | `634311A416164074...` | Epic ID string of victim (raw) |
| `PlayerIsBot` | `bool` | `false` | Whether victim is a bot |
| `FinisherOrDowner` | `int?` | `259` | Actor ID of the **attacker** |
| `FinisherOrDownerName` | `string?` | `634311A416164074...` | Epic ID string of attacker (raw) |
| `FinisherOrDownerIsBot` | `bool` | `false` | Whether attacker is a bot |
| `ReplicatedWorldTimeSecondsDouble` | `double?` | `1176.16` | Exact server time of event (seconds) |
| `Distance` | `float?` | `5200.52` | Distance between attacker and victim **in Unreal Units** (1 UU ≈ 1 cm) |
| `DeathCause` | `int?` | `5` | Cause enum |
| `DeathLocation` | `FVector` | `{X: 38182, Y: 12793, Z: 4216}` | 3D world coordinates of the death |
| `DeathTags` | `IEnumerable<string>` | `["Weapon.Ranged.SMG", "Rarity.Common", ...]` | Full gameplay tag set — weapon type, mods, buffs, states |
| `IsDowned` | `bool` | `true` = knock, `false` = elimination | Whether the event was a knock or a kill |
| `IsRevived` | `bool` | `false` | Whether the event was a revive |

> **Weapon detection from DeathTags**: The analyzer parses `DeathTags` to extract the weapon used:
>
> | Tag Pattern | Example Tag | Extracted |
> |---|---|---|
> | `item.weapon.ranged.[type].[variant]` | `item.weapon.ranged.assault.SunRose` | `Assault: SunRose` |
> | `Item.Weapon.Ranged.[type].[variant]` | `Item.Weapon.Ranged.SMG.DragonCart` | `SMG: DragonCart` |
> | `Weapon.Ranged.[type]` | `Weapon.Ranged.SMG` | `SMG` |
> | Contains `OutsideSafeZone` | `Gameplay.Damage.OutsideSafeZone` | `Storm` |

**Real example from this replay's killfeed:**
```
   1. [03:54] knocked: [BOT ] RudeAwaken1ngz   | Rank: 19 | 757 cm  | Shotgun
   2. [04:09] knocked: [BOT ] Strider0728      | Rank: 19 | 278 cm  | SMG
   3. [05:20] knocked: [BOT ] Quack4Bread      | Rank: 19 | 2189 cm | SMG
   4. [05:40] killed!: [BOT ] UltraDavid26     | Rank: 19 | 339 cm  | Shotgun
   5. [19:36] knocked: [Real] tob1978 (Crown)  | Rank: 2  | 5201 cm | Assault: SunRose
   6. [23:13] killed!: [Real] hymnisch-Beiname | Rank: 2  | 164 cm  | SMG
```

> **Distance note**: Values are in Unreal Units (≈ centimeters). 5201 cm ≈ 52 meters for the sniper shot on tob1978.

---

## 8. Owner Personal Stats (`Stats` – Event Chunk)

These are only available for the replay owner and come from the replay's binary event chunk (not network replication).

| Field | Type | Example Value | Description |
|---|---|---|---|
| `Eliminations` | `uint` | `6` | Total eliminations |
| `Accuracy` | `float` | `0.1198` (→ `12.0%`) | Shot accuracy ratio (0.0 = 0%, 1.0 = 100%) |
| `Assists` | `uint` | `3` | Assisted kills (dealt damage to an enemy another player eliminated) |
| `WeaponDamage` | `uint` | `894` | Damage dealt with weapons |
| `OtherDamage` | `uint` | `169` | Damage from non-weapon sources (storm, fall, explosions) |
| `DamageToPlayers` | `uint` | `1063` | Total damage to players (`WeaponDamage + OtherDamage`) |
| `Revives` | `uint` | `0` | Number of teammates revived |
| `DamageTaken` | `uint` | `699` | Total damage received |
| `DamageToStructures` | `uint` | `4702` | Total damage dealt to buildings/structures |
| `MaterialsGathered` | `uint` | `1606` | Total materials harvested (wood/brick/metal combined) |
| `MaterialsUsed` | `uint` | `1580` | Total materials spent on building |
| `TotalTraveled` | `uint` | `611948` (→ `6119 m`) | Total distance traveled in Unreal Units (÷100 = meters) |

---

## 9. Team Stats (`TeamStats` – Event Chunk)

Summary stats from the event chunk for the owner's team.

| Field | Type | Example Value | Description |
|---|---|---|---|
| `Position` | `uint` | `1` | Finish placement of the team |
| `TotalPlayers` | `uint` | `98` | Total player count as seen by the event system |

---

## 10. Map Data (`MapData`)

### Safe Zones (Storm Circles)

Each phase of the storm is captured as a `SafeZone`:

| Field | Type | Description |
|---|---|---|
| `LastCenter` / `NextCenter` / `NextNextCenter` | `FVector` | Current, next, and following storm center |
| `LastRadius` / `NextRadius` / `NextNextRadius` | `float` | Radius of each circle in Unreal Units |
| `SafeZoneStartShrinkTime` | `float` | Server time when this phase starts closing |
| `SafeZoneFinishShrinkTime` | `float` | Server time when this phase is fully closed |
| `Damage` | `float` | Storm DPS at this phase |
| `PhaseCount` | `float` | Total number of storm phases |
| `CurrentPhase` | `float` | The current phase index |

> **Note**: In this test replay, the SafeZone list was empty (`[]`) because the `SafeZoneIndicator` actor was not captured in Minimal parse mode. Use `ParseMode.Full` to capture storm data.

### Other Map Objects

| Object | Fields Available | Notes |
|---|---|---|
| `Llamas` | Location, item contents | Loot llama spawns |
| `SupplyDrops` | Location, landing position, phase | Air drops |
| `RebootVans` | Location, state | Reboot Van positions |
| `BattleBusFlightPaths` | Start/end positions, flight path | Battle Bus route(s) |
| `WorldGridStart/End/Spacing` | `FVector2D` | Map bounds and grid |

---

## 11. Weapons

Weapon actors are replicated during the match. All types inherit from `BaseWeapon`:

| Field | Type | Example Value | Description |
|---|---|---|---|
| `WeaponData` | `ItemDefinition` | `WID_Assault_AutoHigh_Athena_R_Ore_T03` | Weapon asset name — this IS the weapon ID |
| `AmmoCount` | `int?` | `28` | Ammo currently in the magazine |
| `WeaponLevel` | `int?` | `3` | Upgrade level (1–5) |
| `LastFireTimeVerified` | `float?` | `1287.4` | Server time of the last confirmed shot |
| `bIsEquippingWeapon` | `bool?` | `false` | Whether the weapon is being drawn |
| `bIsReloadingWeapon` | `bool?` | `false` | Whether reloading |
| `AppliedAlterations` | `ItemDefinition[]` | `[Supressor, Laser, Foregrip]` | Weapon mods/attachments applied |

**Weapon types parsed:**

| Category | Types |
|---|---|
| Ranged | Rifles, Shotgun, Sniper, Pistol, Machine Gun, PDW/SMG, Crossbow |
| Explosives | Rocket Launcher, Frag Grenade |
| Melee | Melee |
| Utility | Fishing Rod, Healing, Trap, Building Tool |

### Projectile Data

For fired projectiles (rockets, etc.):

| Field | Description |
|---|---|
| `ReplicatedMovement` | Position + velocity of the projectile in flight |
| `ReplicatedMaxSpeed` | Max speed cap |
| `GravityScale` | How much gravity affects it |
| `StopLocation` | Where it stopped (rockets) |
| `PawnHitResult` | Which player it hit (rockets) |
| `bHasExploded` | Explosion state |

---

## 12. Inventory (`FortInventory`)

Player inventory items are replicated per slot. Each slot provides:

| Field | Type | Description |
|---|---|---|
| `ItemDefinition` | `ItemDefinition` | Asset name of the item (weapon ID, consumable ID, etc.) |
| `Count` | `int?` | Stack size (ammo stacks, consumables) |
| `LoadedAmmo` | `int?` | Ammo loaded in the weapon |
| `Durability` | `float?` | Item durability |
| `Level` | `int?` | Item upgrade level |
| `OrderIndex` | `ushort?` | Slot order (0–5 for weapon slots) |
| `StateValues` | `FortItemEntryStateValue[]` | Extra per-item state values |

---

## 13. Health & Shield (`HealthSet`)

Real-time HP/shield values replicated per player pawn:

| Field | Type | Description |
|---|---|---|
| `HealthCurrentValue` | `float` | Current HP |
| `HealthMaxValue` | `float` | Max HP (typically 100) |
| `HealthBaseValue` | `float` | Base HP before modifiers |
| `ShieldCurrentValue` | `float` | Current shield |
| `ShieldMaxValue` | `float` | Max shield (typically 100) |
| `ShieldBaseValue` | `float` | Base shield before modifiers |

---

## 14. Vehicles

Vehicle actors expose seat occupancy and weapon state:

| Field | Description |
|---|---|
| `SeatComponent.PlayerSlots` | Which player is in which seat |
| `SeatComponent.PlayerEntryTime` | When each player entered |
| `WeaponSeatComponent.bWeaponEquipped` | Whether the vehicle gun is active |
| `WeaponSeatComponent.LastFireTime` | Last time the vehicle weapon fired |
| `Boat.cs` | Boat-specific movement and physics replication |

---

## 15. Spawn Machines (Reboot Vans)

| Field | Type | Description |
|---|---|---|
| `Location` | `FVector` | 3D world position of the machine |
| `SpawnMachineState` | `int` (enum) | 0=Idle, 1=Active, 2=Cooldown |
| `SpawnMachineCooldownStartTime` | `float` | When cooldown began |
| `SpawnMachineCooldownEndTime` | `float` | When cooldown ends |

---

## 16. Map Markers & Social (`FortBroadcastRemoteClientInfo`)

Player actions that affect others are logged via RPC:

| RPC | Description |
|---|---|
| `ClientRemotePlayerAddMapMarker` | Player placed a ping/marker on the map |
| `ClientRemotePlayerRemoveMapMarker` | Player removed a map marker |
| `ClientRemotePlayerDamagedResourceBuilding` | Player damaged a resource node |

---

## 17. Team Private Info (`FortTeamPrivateInfo`)

Data shared only within a team:

| Field | Type | Description |
|---|---|---|
| `LastRepLocation` | `FVector` | Last known position of this teammate |
| `LastRepYaw` | `float?` | Facing direction |
| `PawnStateMask` | `int?` (enum) | Alive / DBNO / Dead state |

---

## 18. Additional `PlayerPawn` Fields (raw, not in `PlayerData`)

These exist in the network data but are not yet surfaced in the exported `PlayerData` model:

| Field | Description |
|---|---|
| `GravityScale` | Current gravity multiplier (useful for gravity zones) |
| `GravityFloorAltitude / Width / Scalar` | Gravity floor mechanic parameters |
| `bReplicatedIsInVortex` | Player is in a vortex zone |
| `bReplicatedIsInSlipperyMovement` | Player on a slippery surface |
| `BuildingState` | Build/edit/combat mode state enum |
| `CapsuleRadiusAthena` | Player hitbox radius |
| `CapsuleHalfHeightAthena` | Player hitbox half-height |
| `WalkSpeed / RunSpeed / SprintSpeed / FlySpeed` | Movement speed values per mode |
| `DBNOHoister` | Actor carrying this DBNO player |
| `DBNORevivalStacking` | How many revive stacks are applied |
| `ServerWorldTimeRevivalTime` | Server time when the revive completes |
| `bInGliderRedeploy` | Glider redeploy currently in progress |
| `bIsTacticalSprinting` | **Tactical sprint active** (Chapter 4+ sprint mechanic) |
| `RemoteViewData32` | Packed view pitch/yaw (used for spectating) |
| `bIsDying` | Player is in the death/ragdoll process |
| `bIsInvulnerable` | Invulnerability active (spawn immunity) |
| `SpawnImmunityTime` | Remaining spawn immunity seconds |
| `EntryTime` | When this player's pawn entered the game world |
| `SeatIndex` | Which vehicle seat the player occupies |
| `Vehicle` | Actor ID of the current vehicle |
| `PackedReplicatedSlopeAngles` | Terrain slope angles (for animations) |
| `GroupEmoteLookTarget` | Target actor for a group emote |
| `AccelerationPack / AccelerationZPack` | Packed acceleration vectors (compressed) |

---

## Summary: What Is vs. Is Not Available

| ✅ Available | ❌ Not Available |
|---|---|
| All player identities, names, Epic IDs | Private messages / voice chat |
| Placement, kills, team index, crown | Exact ping values |
| Full cosmetics (skin/pickaxe/glider/wraps/emotes) | Account stats (career totals) |
| DeathTags → weapon type, mods, buffs | Weapon damage numbers per shot |
| Kill feed: timestamp, distance, location | Build structure positions |
| Owner stats: accuracy, damage, materials, travel | Storm data (only in Full parse mode) |
| Game version, session ID, playlist, modifiers | Anti-cheat data |
| Movement states (sprint, DBNO, skydive, etc.) | Stamina bar value (client-predicted) |
| Health/shield values at replication time | Exact HP at time of death |
| Inventory per slot + ammo | Economy / V-Bucks |
| Weapon actor data: ammo, level, fire time | Replay of other players' damage dealt |
| Map: llamas, supply drops, reboot vans, bus path | Per-material breakdown (wood/brick/metal) |
| Tactical Sprint flag (`bIsTacticalSprinting`) | Stamina percentage value |
