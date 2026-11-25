export const PIPER_VOICES_COMMIT = 'cf910fb59f1d79ab3b625a63993a108751c6c25d'

export type FolioLicence = 'CC0-1.0' | 'CC-BY-4.0' | 'public-domain'

export const LICENCES: Record<FolioLicence, { name: string; url: string | null }> = {
  'CC0-1.0': { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  'CC-BY-4.0': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  'public-domain': { name: 'Public domain', url: null },
}

export const BASES = {
  hifi: {
    name: 'hifi_tts_92',
    credit: 'Hi-Fi Multi-Speaker English TTS, NVIDIA Corporation',
    url: 'https://www.openslr.org/109/',
    licence: 'CC-BY-4.0',
  },
  rdh: { name: 'rdh', credit: null, url: null, licence: 'CC0-1.0' },
} as const satisfies Record<string, { name: string; credit: string | null; url: string | null; licence: FolioLicence }>

export interface FolioVoiceFile {
  path: string
  bytes: number
  sha256: string
}

export interface FolioVoice {
  id: string
  name: string
  lang: string
  gender: 'female' | 'male' | null
  licence: FolioLicence
  base: keyof typeof BASES | null
  dataset: { name: string; url: string; by: string | null }
  files: { onnx: FolioVoiceFile; config: FolioVoiceFile; card: FolioVoiceFile }
  bytes: number
}

export const FOLIO_VOICES: readonly FolioVoice[] = [
  {
    id: 'en_GB-cori-medium',
    bytes: 63228626,
    name: 'Cori',
    lang: 'en-GB',
    gender: 'female',
    licence: 'CC-BY-4.0',
    base: 'hifi',
    dataset: {
      name: 'Hi-Fi Multi-Speaker English TTS (reader 92, Cori Samuel)',
      url: 'https://www.openslr.org/109/',
      by: 'Cori Samuel, a LibriVox reader, and NVIDIA Corporation',
    },
    files: {
      onnx: {
        path: 'en/en_GB/cori/medium/en_GB-cori-medium.onnx',
        bytes: 63221984,
        sha256: '2e0a55e140de672aa19b182602b407607bd2e6c35fc6020c0b1516053c02e995',
      },
      config: {
        path: 'en/en_GB/cori/medium/en_GB-cori-medium.onnx.json',
        bytes: 5471,
        sha256: 'f89b01c5e483c75ce9085ff89c79446c1a95a1cb4a362f629dac3b5a4b5dde75',
      },
      card: {
        path: 'en/en_GB/cori/medium/MODEL_CARD',
        bytes: 1171,
        sha256: 'b1cdf93d1b0586941518677eb69c4ebd2db65573c57daeb7e45d3a658aae6cb8',
      },
    },
  },
  {
    id: 'en_US-ljspeech-medium',
    bytes: 63536868,
    name: 'LJSpeech',
    lang: 'en-US',
    gender: 'female',
    licence: 'public-domain',
    base: null,
    dataset: {
      name: 'LJ Speech',
      url: 'https://keithito.com/LJ-Speech-Dataset/',
      by: 'Keith Ito; the voice trained by Bryce Beattie',
    },
    files: {
      onnx: {
        path: 'en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx',
        bytes: 63531379,
        sha256: '6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22',
      },
      config: {
        path: 'en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx.json',
        bytes: 4972,
        sha256: '141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860',
      },
      card: {
        path: 'en/en_US/ljspeech/medium/MODEL_CARD',
        bytes: 517,
        sha256: 'fbee1529c89d36b3fe76d7e9f3f832dce17f44900a52d76a9bda735654766b4d',
      },
    },
  },
  {
    id: 'de_DE-thorsten-medium',
    bytes: 63227871,
    name: 'Thorsten',
    lang: 'de-DE',
    gender: null,
    licence: 'CC0-1.0',
    base: 'rdh',
    dataset: {
      name: 'Thorsten-Voice',
      url: 'https://github.com/thorstenMueller/Thorsten-Voice',
      by: 'Thorsten Müller',
    },
    files: {
      onnx: {
        path: 'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx',
        bytes: 63221984,
        sha256: 'fd270eb3d1ebf91d763f8a0f949b1b1bebdfefaea18c3aaf8577dd34536e064f',
      },
      config: {
        path: 'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json',
        bytes: 5460,
        sha256: 'cf245c91668e74cb6716f38647ae3d6d9bac42965872596f65f9ab2b7d7221ed',
      },
      card: {
        path: 'de/de_DE/thorsten/medium/MODEL_CARD',
        bytes: 427,
        sha256: 'c638118fb06eb07d59e60270097c250cf2de81a037320a8a6306fec652ad13b0',
      },
    },
  },
  {
    id: 'fr_FR-siwis-medium',
    bytes: 63227944,
    name: 'Siwis',
    lang: 'fr-FR',
    gender: null,
    licence: 'CC-BY-4.0',
    base: 'hifi',
    dataset: {
      name: 'SIWIS French Speech Synthesis Database',
      url: 'https://datashare.is.ed.ac.uk/handle/10283/2353',
      by: null,
    },
    files: {
      onnx: {
        path: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx',
        bytes: 63221984,
        sha256: 'b1d946fd68d0347155fa59bce0a018924abbef3c1561181db45ca463d83963ef',
      },
      config: {
        path: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json',
        bytes: 5458,
        sha256: 'df814aa3dfedd00510a07144442cc0a220ff21e43d03c3b078444fc0be68fc37',
      },
      card: {
        path: 'fr/fr_FR/siwis/medium/MODEL_CARD',
        bytes: 502,
        sha256: 'f75d76ec577b5e7a49a7462883d31ef65383022387818a9a0b75bdaf90b9010c',
      },
    },
  },
  {
    id: 'es_ES-davefx-medium',
    bytes: 63227860,
    name: 'Davefx',
    lang: 'es-ES',
    gender: null,
    licence: 'CC0-1.0',
    base: 'rdh',
    dataset: { name: 'OHF-Voice voice datasets', url: 'https://github.com/OHF-Voice/voice-datasets', by: null },
    files: {
      onnx: {
        path: 'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx',
        bytes: 63221984,
        sha256: 'd2c9224e122321aac3c33343957fff4d0f465226cb74c66b0f520ca3f8c0dd07',
      },
      config: {
        path: 'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json',
        bytes: 5458,
        sha256: '531c4051502e1acbc10b42437f11679bfce9e3919e1796e51fabd73e01e7fd2e',
      },
      card: {
        path: 'es/es_ES/davefx/medium/MODEL_CARD',
        bytes: 418,
        sha256: '2d55d0d84100cde9d9ed88866c2625c89d333a45507d88aa8bae40f6de94c134',
      },
    },
  },
  {
    id: 'it_IT-serena-medium',
    bytes: 63521571,
    name: 'Serena',
    lang: 'it-IT',
    gender: null,
    licence: 'CC-BY-4.0',
    base: null,
    dataset: {
      name: 'serena-synthetic-it-27h',
      url: 'https://huggingface.co/datasets/committa/serena-synthetic-it-27h',
      by: null,
    },
    files: {
      onnx: {
        path: 'it/it_IT/serena/medium/it_IT-serena-medium.onnx',
        bytes: 63516051,
        sha256: 'fe4e26b2c1236e2a44d2e295cad564d94a0d8b0a9fca1ccdfd70dd4af3116eb5',
      },
      config: {
        path: 'it/it_IT/serena/medium/it_IT-serena-medium.onnx.json',
        bytes: 5254,
        sha256: '14cb4995874138b2792ae07753b5540942124761af9ae6609f9b520f28837881',
      },
      card: {
        path: 'it/it_IT/serena/medium/MODEL_CARD',
        bytes: 266,
        sha256: '1d0dbdc0182d19f6510fd3dcd2893587912a65f8cafe6da57754863f168bbe7e',
      },
    },
  },
  {
    id: 'pt_BR-cadu-medium',
    bytes: 63227869,
    name: 'Cadu',
    lang: 'pt-BR',
    gender: null,
    licence: 'CC0-1.0',
    base: 'rdh',
    dataset: { name: 'OHF-Voice voice datasets', url: 'https://github.com/OHF-Voice/voice-datasets', by: null },
    files: {
      onnx: {
        path: 'pt/pt_BR/cadu/medium/pt_BR-cadu-medium.onnx',
        bytes: 63221984,
        sha256: 'd5a662e3f606d5a49dd29ba9ce90c304ae45dd9543f8b0c773bcb0de282499de',
      },
      config: {
        path: 'pt/pt_BR/cadu/medium/pt_BR-cadu-medium.onnx.json',
        bytes: 5465,
        sha256: '9fa837b7c1237ea5978bcd7be38c130798e8faa064f754873bb4ce5fc498bd88',
      },
      card: {
        path: 'pt/pt_BR/cadu/medium/MODEL_CARD',
        bytes: 420,
        sha256: 'ccd97b4369f50e6fba3a4fb730643ef2675f87b43c5d22298404c58f8204a375',
      },
    },
  },
  {
    id: 'nl_NL-pim-medium',
    bytes: 63227865,
    name: 'Pim',
    lang: 'nl-NL',
    gender: null,
    licence: 'CC0-1.0',
    base: 'rdh',
    dataset: { name: 'OHF-Voice voice datasets', url: 'https://github.com/OHF-Voice/voice-datasets', by: null },
    files: {
      onnx: {
        path: 'nl/nl_NL/pim/medium/nl_NL-pim-medium.onnx',
        bytes: 63221984,
        sha256: '1e1ed370c3b60ca734e525bdcd1f05f71b42bfb0a15693f1e89c012d72052d2a',
      },
      config: {
        path: 'nl/nl_NL/pim/medium/nl_NL-pim-medium.onnx.json',
        bytes: 5461,
        sha256: '30e5689c492f27d9c6cb8e23de78087162d3205fa8e169c33fd80bd80cbb133b',
      },
      card: {
        path: 'nl/nl_NL/pim/medium/MODEL_CARD',
        bytes: 420,
        sha256: '3f7439321a995ecd70fdf480d4702147abb06fc9deca6d195fe5b339fb2b6d15',
      },
    },
  },
  {
    id: 'pl_PL-darkman-medium',
    bytes: 63227860,
    name: 'Darkman',
    lang: 'pl-PL',
    gender: null,
    licence: 'CC0-1.0',
    base: 'rdh',
    dataset: { name: 'OHF-Voice voice datasets', url: 'https://github.com/OHF-Voice/voice-datasets', by: null },
    files: {
      onnx: {
        path: 'pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx',
        bytes: 63221984,
        sha256: 'cf757ee307e3a7c23d5d8f69934deab51683d01c1c6be376d3e13146020f1530',
      },
      config: {
        path: 'pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx.json',
        bytes: 5457,
        sha256: '0d98a67829a1b7ffbce7faacf4ea7bb7a7ce2ebc1598ad0289c0f6c1f352dbd0',
      },
      card: {
        path: 'pl/pl_PL/darkman/medium/MODEL_CARD',
        bytes: 419,
        sha256: 'a2c89d3059a830d47fb0159973088c02ae3a4c7e56235a3abe63b9507340bdab',
      },
    },
  },
  {
    id: 'ru_RU-denis-medium',
    bytes: 63227866,
    name: 'Denis',
    lang: 'ru-RU',
    gender: null,
    licence: 'CC0-1.0',
    base: 'rdh',
    dataset: { name: 'OHF-Voice voice datasets', url: 'https://github.com/OHF-Voice/voice-datasets', by: null },
    files: {
      onnx: {
        path: 'ru/ru_RU/denis/medium/ru_RU-denis-medium.onnx',
        bytes: 63221984,
        sha256: '879bc365cb14d1380e3f5ed6044162ccf54c99f6161871569b7f830aec3ce841',
      },
      config: {
        path: 'ru/ru_RU/denis/medium/ru_RU-denis-medium.onnx.json',
        bytes: 5464,
        sha256: 'e4fb4ab60262d1ab802c8c39301976c4135e545bc834a33c6eedc1f764df3bd6',
      },
      card: {
        path: 'ru/ru_RU/denis/medium/MODEL_CARD',
        bytes: 418,
        sha256: '917110d5056810771fd3daea2644bbadf1341816b7631f2043b33be245903432',
      },
    },
  },
  {
    id: 'uk_UA-ukrainian_tts-medium',
    bytes: 76737932,
    name: 'Ukrainian TTS',
    lang: 'uk-UA',
    gender: null,
    licence: 'CC0-1.0',
    base: null,
    dataset: { name: 'OHF-Voice voice datasets', url: 'https://github.com/OHF-Voice/voice-datasets', by: null },
    files: {
      onnx: {
        path: 'uk/uk_UA/ukrainian_tts/medium/uk_UA-ukrainian_tts-medium.onnx',
        bytes: 76735663,
        sha256: '7920419ac5f6fd8b6450520f24b52ed5a319cb53dd018fbcd71c9e079cbac84f',
      },
      config: {
        path: 'uk/uk_UA/ukrainian_tts/medium/uk_UA-ukrainian_tts-medium.onnx.json',
        bytes: 2002,
        sha256: '4e96e72917ca9b94edc77d6ccfee03a73f450ba2fc1ca93c2e562bc014e5aa55',
      },
      card: {
        path: 'uk/uk_UA/ukrainian_tts/medium/MODEL_CARD',
        bytes: 267,
        sha256: 'ce09d0c9d1d90cdc98d1ea8a4ecbdeb5e937d44593876e4194302c5eabbaad9d',
      },
    },
  },
  {
    id: 'sv_SE-nst-medium',
    bytes: 63108989,
    name: 'NST',
    lang: 'sv-SE',
    gender: null,
    licence: 'CC0-1.0',
    base: null,
    dataset: {
      name: 'NST Swedish speech synthesis (Språkbanken)',
      url: 'https://www.nb.no/sprakbanken/en/resource-catalogue/oai-nb-no-sbr-17/',
      by: 'KBLab at the National Library of Sweden',
    },
    files: {
      onnx: {
        path: 'sv/sv_SE/nst/medium/sv_SE-nst-medium.onnx',
        bytes: 63104526,
        sha256: 'df011f56825a59dd1efc080c38a65a1ef70407e60f63050e9246f43a3d7e471e',
      },
      config: {
        path: 'sv/sv_SE/nst/medium/sv_SE-nst-medium.onnx.json',
        bytes: 4157,
        sha256: 'd45dd74cbb4eca58694bf04a97e243044092476f28a55ae26424f0653086980a',
      },
      card: {
        path: 'sv/sv_SE/nst/medium/MODEL_CARD',
        bytes: 306,
        sha256: 'c85d3e26e47d93e9d9b8572d3c89537c3f8ff212595cb9a3fbd2e07c19432317',
      },
    },
  },
  {
    id: 'no_NO-nvcc-medium',
    bytes: 76775892,
    name: 'NVCC',
    lang: 'no-NO',
    gender: null,
    licence: 'CC0-1.0',
    base: null,
    dataset: {
      name: 'Språkbanken resource sbr-75',
      url: 'https://www.nb.no/sprakbanken/en/resource-catalogue/oai-nb-no-sbr-75/',
      by: null,
    },
    files: {
      onnx: {
        path: 'no/no_NO/nvcc/medium/no_NO-nvcc-medium.onnx',
        bytes: 76770227,
        sha256: '3f51702946d9544898440a1a66906155661a9d680ee103130ff68f73360b512e',
      },
      config: {
        path: 'no/no_NO/nvcc/medium/no_NO-nvcc-medium.onnx.json',
        bytes: 5397,
        sha256: '98410e911e5a9076ac4677a79b08b20f98c54f550c4388e29978f6bafa32b83d',
      },
      card: {
        path: 'no/no_NO/nvcc/medium/MODEL_CARD',
        bytes: 268,
        sha256: '309bb60e631d9c826e862bb0f5732eefd9d2fc4a2ca442b8f93fcf69c78cb3bd',
      },
    },
  },
  {
    id: 'fi_FI-harri-medium',
    bytes: 63227886,
    name: 'Harri',
    lang: 'fi-FI',
    gender: null,
    licence: 'CC0-1.0',
    base: 'rdh',
    dataset: {
      name: 'Finnish Single Speaker Speech Dataset',
      url: 'https://www.kaggle.com/bryanpark/finnish-single-speaker-speech-dataset',
      by: null,
    },
    files: {
      onnx: {
        path: 'fi/fi_FI/harri/medium/fi_FI-harri-medium.onnx',
        bytes: 63221984,
        sha256: '315cd970fc5e3dbae98998cbe9926527196c0a3ebdc7e02e21bd9e7325fd085b',
      },
      config: {
        path: 'fi/fi_FI/harri/medium/fi_FI-harri-medium.onnx.json',
        bytes: 5456,
        sha256: 'b1ed2261d1778ed9aa036cee0ef2811dfe01e8bd44cc2a9804063c7930097d04',
      },
      card: {
        path: 'fi/fi_FI/harri/medium/MODEL_CARD',
        bytes: 446,
        sha256: '49561a63fbbe0bf678a84102617615e2aa7b0b2396417e21773ba795dedd74f5',
      },
    },
  },
  {
    id: 'hu_HU-imre-medium',
    bytes: 63227862,
    name: 'Imre',
    lang: 'hu-HU',
    gender: null,
    licence: 'CC0-1.0',
    base: 'rdh',
    dataset: { name: 'OHF-Voice voice datasets', url: 'https://github.com/OHF-Voice/voice-datasets', by: null },
    files: {
      onnx: {
        path: 'hu/hu_HU/imre/medium/hu_HU-imre-medium.onnx',
        bytes: 63221984,
        sha256: 'bcec8e6e5404baca0fcaf2895da4d02d414d3340b9f80bd94a2112b5c67061ae',
      },
      config: {
        path: 'hu/hu_HU/imre/medium/hu_HU-imre-medium.onnx.json',
        bytes: 5458,
        sha256: '760857edbd31947a853842df5833bd16aa1f660feabe11fbebb0a378bf8328c5',
      },
      card: {
        path: 'hu/hu_HU/imre/medium/MODEL_CARD',
        bytes: 420,
        sha256: '948c1d744bfe1431ad06bcc3aa1e8be2ff275b46c80dda7e8c5d05ae4722bf4c',
      },
    },
  },
  {
    id: 'ro_RO-mihai-medium',
    bytes: 63227864,
    name: 'Mihai',
    lang: 'ro-RO',
    gender: null,
    licence: 'CC0-1.0',
    base: 'rdh',
    dataset: { name: 'OHF-Voice voice datasets', url: 'https://github.com/OHF-Voice/voice-datasets', by: null },
    files: {
      onnx: {
        path: 'ro/ro_RO/mihai/medium/ro_RO-mihai-medium.onnx',
        bytes: 63221984,
        sha256: 'ac9e1be65c059279c53500f11e8c276657c7e48a2d33b733add35dbe75748e29',
      },
      config: {
        path: 'ro/ro_RO/mihai/medium/ro_RO-mihai-medium.onnx.json',
        bytes: 5460,
        sha256: '9fbd3514535fa11fe01c41f0b7277ac6a32e08b2580c799c4f1fc86bb9c30841',
      },
      card: {
        path: 'ro/ro_RO/mihai/medium/MODEL_CARD',
        bytes: 420,
        sha256: '40fc63296c26be3d826390102a39e6e90b299b6431210c33a368338a3f9f2a8b',
      },
    },
  },
  {
    id: 'bg_BG-dimitar-medium',
    bytes: 63227883,
    name: 'Dimitar',
    lang: 'bg-BG',
    gender: null,
    licence: 'CC0-1.0',
    base: 'rdh',
    dataset: { name: 'OHF-Voice voice datasets', url: 'https://github.com/OHF-Voice/voice-datasets', by: null },
    files: {
      onnx: {
        path: 'bg/bg_BG/dimitar/medium/bg_BG-dimitar-medium.onnx',
        bytes: 63221984,
        sha256: '2305bc55def71c799fbfc866d15415f57a3465097b7bf9be41a14a26574ad6f3',
      },
      config: {
        path: 'bg/bg_BG/dimitar/medium/bg_BG-dimitar-medium.onnx.json',
        bytes: 5474,
        sha256: 'aa3b0cf8236c205ce953d449e112e184ebde325e7db82e769cfcf2926c375631',
      },
      card: {
        path: 'bg/bg_BG/dimitar/medium/MODEL_CARD',
        bytes: 425,
        sha256: '88fd2a9181a24bb4dbd21b76e2f8aad9eafb43fd1d78cd1ef4a5bbd0ac2eb6f8',
      },
    },
  },
  {
    id: 'el_GR-rapunzelina-medium',
    bytes: 62955293,
    name: 'Rapunzelina',
    lang: 'el-GR',
    gender: null,
    licence: 'CC0-1.0',
    base: null,
    dataset: {
      name: 'Greek Single Speaker Speech Dataset',
      url: 'https://www.kaggle.com/datasets/bryanpark/greek-single-speaker-speech-dataset',
      by: null,
    },
    files: {
      onnx: {
        path: 'el/el_GR/rapunzelina/medium/el_GR-rapunzelina-medium.onnx',
        bytes: 62950044,
        sha256: '3ca9fb3092215ee92edfc019b43feb0115ff4dfe638eb34474833ab1de840952',
      },
      config: {
        path: 'el/el_GR/rapunzelina/medium/el_GR-rapunzelina-medium.onnx.json',
        bytes: 4973,
        sha256: '3a6182ec7c7550e14ef15e5d9badbb18f973a434086ac9658a1b10991fd192f8',
      },
      card: {
        path: 'el/el_GR/rapunzelina/medium/MODEL_CARD',
        bytes: 276,
        sha256: 'dc69f15382dabed061fa8d31b65c14e5c4b57ba2fe6906012c756478da156b50',
      },
    },
  },
  {
    id: 'ne_NP-chitwan-medium',
    bytes: 63227871,
    name: 'Chitwan',
    lang: 'ne-NP',
    gender: null,
    licence: 'CC0-1.0',
    base: 'rdh',
    dataset: { name: 'OHF-Voice voice datasets', url: 'https://github.com/OHF-Voice/voice-datasets', by: null },
    files: {
      onnx: {
        path: 'ne/ne_NP/chitwan/medium/ne_NP-chitwan-medium.onnx',
        bytes: 63221984,
        sha256: '093c497b0cbe9385bb3af2f2cf3fbc400fe1e07803b2ab43e369c49991ba7e82',
      },
      config: {
        path: 'ne/ne_NP/chitwan/medium/ne_NP-chitwan-medium.onnx.json',
        bytes: 5468,
        sha256: '7ff3e502f1af02880e54753e04e1d8bda5905c8d981e3763b4688d12994339e6',
      },
      card: {
        path: 'ne/ne_NP/chitwan/medium/MODEL_CARD',
        bytes: 419,
        sha256: 'dbc908356b71858b89020de9aa81e5f35456f9d8ecdc417ced4712e27b708bb7',
      },
    },
  },
  {
    id: 'kk_KZ-issai-high',
    bytes: 127868853,
    name: 'ISSAI',
    lang: 'kk-KZ',
    gender: null,
    licence: 'CC-BY-4.0',
    base: null,
    dataset: { name: 'Kazakh TTS', url: 'https://github.com/IS2AI/Kazakh_TTS', by: 'ISSAI' },
    files: {
      onnx: {
        path: 'kk/kk_KZ/issai/high/kk_KZ-issai-high.onnx',
        bytes: 127864258,
        sha256: '4dee767c893e8535da821447d12cb030e3569e11254c14030a1da5d8b2222c16',
      },
      config: {
        path: 'kk/kk_KZ/issai/high/kk_KZ-issai-high.onnx.json',
        bytes: 4358,
        sha256: 'eb145ac8712b87beda9f0266e95b98cad76acce89d4626cd8b1408234e9842f0',
      },
      card: {
        path: 'kk/kk_KZ/issai/high/MODEL_CARD',
        bytes: 237,
        sha256: '1b0704348a17a5f84fba84caa20d14a116eea9953bb9bc147ada4234d18687a2',
      },
    },
  },
]

export const ENGINE_BYTES = 14_848_852 + 635_212 + 18_077_249

const SAME_LANGUAGE: Record<string, string> = { nb: 'no', nn: 'no' }

function tagParts(tag: string): { base: string; region: string | null } {
  const [first = '', ...rest] = tag.replace(/_/g, '-').toLowerCase().split('-')
  return { base: SAME_LANGUAGE[first] ?? first, region: rest.find((p) => /^[a-z]{2}$|^\d{3}$/.test(p)) ?? null }
}

export function folioVoicesFor(lang: string, locale?: string): FolioVoice[] {
  const book = tagParts(lang)
  const reader = tagParts(locale ?? '')
  const region = book.region ?? (reader.base === book.base ? reader.region : null)
  const matching = FOLIO_VOICES.filter((v) => tagParts(v.lang).base === book.base)
  const own = matching.filter((v) => region !== null && tagParts(v.lang).region === region)
  return [...own, ...matching.filter((v) => !own.includes(v))]
}

export const folioVoice = (id: string): FolioVoice | null => FOLIO_VOICES.find((v) => v.id === id) ?? null

function extension(file: FolioVoiceFile): string {
  if (file.path.endsWith('.onnx')) return 'onnx'
  if (file.path.endsWith('.onnx.json')) return 'json'
  return 'md'
}

export const voiceUrl = (file: FolioVoiceFile, id: string) =>
  `/voices/${id}.${file.sha256.slice(0, 12)}.${extension(file)}`

export const voiceFileName = (file: FolioVoiceFile, id: string) => voiceUrl(file, id).slice('/voices/'.length)

export const filesOfVoice = (v: FolioVoice): FolioVoiceFile[] => [v.files.onnx, v.files.config, v.files.card]

export const voiceFiles = (v: FolioVoice) => filesOfVoice(v).map((file) => ({ file, url: voiceUrl(file, v.id) }))

export const aboutMegabytes = (bytes: number) => `About ${megabytes(bytes)}`

export const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`

export const ENGINE_SOFTWARE = [
  {
    name: 'piper-wasm',
    version: '1.0.0',
    what: 'piper-phonemize and espeak-ng, compiled to WebAssembly by Diffusion Studio',
    licence: { name: 'GPL-3.0', url: 'https://www.gnu.org/licenses/gpl-3.0.html' },
    source: 'https://github.com/diffusion-studio/piper-wasm',
    parts: [
      { name: 'espeak-ng', source: 'https://github.com/rhasspy/espeak-ng' },
      { name: 'piper-phonemize', source: 'https://github.com/wide-video/piper-phonemize' },
    ],
  },
  {
    name: 'Piper',
    version: null,
    what: 'the voices’ model format and the way their phonemes become ids, from the Open Home Foundation',
    licence: { name: 'GPL-3.0', url: 'https://www.gnu.org/licenses/gpl-3.0.html' },
    source: 'https://github.com/OHF-Voice/piper1-gpl',
    parts: [],
  },
  {
    name: 'onnxruntime-web',
    version: '1.31.1',
    what: 'runs the voice’s model, by Microsoft',
    licence: { name: 'MIT', url: 'https://github.com/microsoft/onnxruntime/blob/v1.31.1/LICENSE' },
    source: 'https://github.com/microsoft/onnxruntime/tree/v1.31.1',
    parts: [],
  },
] as const
