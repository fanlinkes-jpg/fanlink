/**
 * Forma real de api2 (sondeo 09afb02, cuenta de prueba).
 * Los números y los textos son inventados. No son los de esa cuenta.
 */

export const VAULT_LISTS_FIXTURE = {
  list: [
    {
      id: 111,
      type: "stories",
      name: "Historias",
      hasMedia: false,
      canUpdate: false,
      canDelete: false,
      videosCount: 0,
      photosCount: 0,
      gifsCount: 0,
      audiosCount: 0,
      medias: [] as Array<{ type: string; url: string }>,
    },
    {
      id: 222,
      type: "posts",
      name: "Publicaciones",
      hasMedia: true,
      canUpdate: false,
      canDelete: false,
      videosCount: 1,
      photosCount: 3,
      gifsCount: 0,
      audiosCount: 0,
      medias: [{ type: "photo", url: "https://cdn2.onlyfans.com/files/cover.jpg" }],
    },
    {
      id: 333,
      type: "custom",
      name: "Carpeta de ejemplo",
      hasMedia: true,
      canUpdate: true,
      canDelete: true,
      videosCount: 2,
      photosCount: 5,
      gifsCount: 0,
      audiosCount: 0,
      medias: [{ type: "video", url: "https://cdn2.onlyfans.com/files/folder.jpg" }],
    },
  ],
  all: {
    videosCount: 7,
    photosCount: 12,
    gifsCount: 1,
    audiosCount: 0,
    medias: [{ type: "photo", url: "https://cdn2.onlyfans.com/files/all.jpg" }],
  },
  hasMore: false,
  canCreateVaultLists: true,
  order: "asc",
  sort: "custom",
};

export const VAULT_MEDIA_ITEM = {
  id: 9001,
  type: "video",
  convertedToVideo: false,
  canView: true,
  hasError: false,
  createdAt: "2026-03-01T00:00:00+00:00",
  isReady: true,
  counters: { likesCount: 2, tipsSumm: "0", buyersCount: 0 },
  files: {
    full: {
      url: "https://cdn2.onlyfans.com/files/full.mp4",
      width: 720,
      height: 1280,
      size: 1000,
      sources: [] as string[],
    },
    thumb: { url: "https://cdn2.onlyfans.com/files/t.jpg", width: 300, height: 300 },
    preview: { url: "https://cdn2.onlyfans.com/files/p.jpg", width: 480, height: 480 },
    squarePreview: { url: "https://cdn2.onlyfans.com/files/s.jpg", width: 300, height: 300 },
  },
  duration: 8,
  hasPosts: false,
  listStates: [{ id: 333, type: "custom", name: "Carpeta de ejemplo", hasMedia: true, canAddMedia: true }],
  hasCustomPreview: false,
  videoSources: { "240": "https://cdn2.onlyfans.com/files/240.mp4", "720": null as string | null },
};

export const VAULT_MEDIA_ALL_FIXTURE = {
  list: [VAULT_MEDIA_ITEM],
  hasMore: false,
};

/** `list=<id>` vuelve vacía. Los medios de la carpeta van con `list_id`. */
export const VAULT_MEDIA_LIST_PARAM_FIXTURE = {
  list: [] as unknown[],
  hasMore: false,
};

export const VAULT_MEDIA_FOLDER_FIXTURE = {
  list: [VAULT_MEDIA_ITEM],
  hasMore: false,
};
