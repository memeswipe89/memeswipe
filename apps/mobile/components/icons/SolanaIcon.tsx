import React, { memo } from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

type SolanaIconProps = {
  size?: number;
};

export const SolanaIcon = memo(function SolanaIcon({ size = 16 }: SolanaIconProps) {
  const height = Math.round(size * 0.78);
  return (
    <Svg width={size} height={height} viewBox="0 0 64 50" fill="none" accessibilityLabel="Solana">
      <Defs>
        <LinearGradient id="sol" x1="6" y1="0" x2="58" y2="50" gradientUnits="userSpaceOnUse">
          <Stop stopColor="#00FFA3" />
          <Stop offset="1" stopColor="#DC1FFF" />
        </LinearGradient>
      </Defs>

      <Path
        d="M12.4 5.4C13.4 4.3 14.7 3.7 16.2 3.7H58.3C59.1 3.7 59.5 4.6 58.9 5.2L51.6 13.2C50.6 14.3 49.3 14.9 47.8 14.9H5.7C4.9 14.9 4.5 14 5.1 13.4L12.4 5.4Z"
        fill="url(#sol)"
      />
      <Path
        d="M12.4 29.5C13.4 28.4 14.7 27.8 16.2 27.8H58.3C59.1 27.8 59.5 28.7 58.9 29.3L51.6 37.3C50.6 38.4 49.3 39 47.8 39H5.7C4.9 39 4.5 38.1 5.1 37.5L12.4 29.5Z"
        fill="url(#sol)"
      />
      <Path
        d="M51.6 17.4C50.6 16.3 49.3 15.7 47.8 15.7H5.7C4.9 15.7 4.5 16.6 5.1 17.2L12.4 25.2C13.4 26.3 14.7 26.9 16.2 26.9H58.3C59.1 26.9 59.5 26 58.9 25.4L51.6 17.4Z"
        fill="url(#sol)"
      />
    </Svg>
  );
});
