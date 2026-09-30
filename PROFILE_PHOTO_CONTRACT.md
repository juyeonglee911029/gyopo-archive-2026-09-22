# Public Profile Photo Contract

This contract is shared by the web client, Firestore rules, and future native clients.

- `profiles/{uid}.profilePhotos` and `publicProfiles/{uid}.profilePhotos` contain the same ordered array of publicly accessible HTTPS photo URLs.
- Older profiles without `profilePhotos` are treated as having an empty array.
- The array holds at most five unique photos. The separate avatar field (`image`) does not count toward the minimum. The profile editor resizes uploads to 640 pixels maximum and stores them under `profiles/{uid}/gallery/{uuid}.jpg`.
- Anyone can read the gallery through `publicProfiles`; these are public photos, not private or friends-only media.
- A new random match or friend connection requires at least three uploaded photos from both members. Firestore rules enforce this when queue matches and friend connections are created or accepted.
- An established friend call remains available regardless of later photo changes; photo requirements do not revoke an existing relationship or call.
- In a match view, a viewer with three or four photos sees up to the first three photos in the other member's ordered gallery. A viewer with five sees the full gallery. A viewer below three sees no match gallery. Public member profiles still show the full public gallery.
- Derive eligibility from the array length; do not store a separate count. Native clients should implement the same constants: maximum 5, minimum 3, preview 3.

The web implementation centralizes normalization and display policy in `src/lib/profilePhotos.ts`. Firestore rules are the authoritative eligibility check; client checks are for immediate feedback only.
