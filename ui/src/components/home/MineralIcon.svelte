<script lang="ts">
  import { settings } from '../../lib/settings.svelte';
  import { mineralKey } from '../../lib/home';
  import zirconLight from '../../assets/minerals/zircon-light.svg?no-inline';
  import zirconDark from '../../assets/minerals/zircon-dark.svg?no-inline';
  import apatiteLight from '../../assets/minerals/apatite-light.svg?no-inline';
  import apatiteDark from '../../assets/minerals/apatite-dark.svg?no-inline';
  import rutileLight from '../../assets/minerals/rutile-light.svg?no-inline';
  import rutileDark from '../../assets/minerals/rutile-dark.svg?no-inline';
  import titaniteLight from '../../assets/minerals/titanite-light.svg?no-inline';
  import titaniteDark from '../../assets/minerals/titanite-dark.svg?no-inline';
  import monaziteLight from '../../assets/minerals/monazite-light.svg?no-inline';
  import monaziteDark from '../../assets/minerals/monazite-dark.svg?no-inline';
  import otherLight from '../../assets/minerals/other-light.svg?no-inline';
  import otherDark from '../../assets/minerals/other-dark.svg?no-inline';

  let { mineral, size = 16 }: { mineral: string; size?: number } = $props();
  // Keep the small SVGs as hashed files in production, rather than data URLs.
  const icons: Record<string, [string, string]> = {
    zircon: [zirconLight, zirconDark], apatite: [apatiteLight, apatiteDark],
    rutile: [rutileLight, rutileDark], titanite: [titaniteLight, titaniteDark],
    monazite: [monaziteLight, monaziteDark], other: [otherLight, otherDark],
  };
  const key = $derived(mineralKey(mineral));
  const src = $derived(icons[Object.hasOwn(icons, key) ? key : 'other'][settings.effectiveTheme === 'dark' ? 1 : 0]);
</script>

<img {src} width={size} height={size} alt="" aria-hidden="true" />

<style>
  img { display: block; flex: none; object-fit: contain; }
</style>
