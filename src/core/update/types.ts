export interface PackageUpdate {
  name: string;
  installedVersion: string;
  latestVersion: string;
  updateType: 'patch' | 'minor' | 'major';
}

export interface UpdateManifest {
  checkedAt: string;
  packages: PackageUpdate[];
  hasUpdates: boolean;
}
