// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title LandRegistry
 * @notice Permissioned Hyperledger Besu registry coordinating parcel verification,
 *         ERC-721 title issuance, registry-controlled transfers, and Section 28 revocations.
 * @dev Never stores raw PII on-chain; stores salted owner commitment hashes and document Merkle roots.
 */
interface ILandTitleNFT {
    function mintTitle(address to, string calldata parcelRef, bytes32 metadataHash) external returns (uint256);
    function registryTransfer(address from, address to, uint256 tokenId) external;
    function revokeTitle(uint256 tokenId) external;
    function isRevoked(uint256 tokenId) external view returns (bool);
}

contract LandRegistry {
    enum ParcelStatus {
        Pending,
        Registered,
        Revoked
    }

    enum RevocationGround {
        None,
        OverridingPublicInterest,
        BreachOfStatutoryConditions
    }

    struct ParcelRecord {
        string parcelRef;
        bytes32 ownerCommitmentHash;
        bytes32 geoBoundaryHash;
        bytes32 documentMerkleRoot;
        uint256 nftTokenId;
        ParcelStatus status;
        RevocationGround revocationGround;
        string gazetteOrderRef;
        uint256 registeredAt;
        uint256 revokedAt;
    }

    address public sysAdmin;
    ILandTitleNFT public titleNFT;

    mapping(address => bool) public isRegistrar;
    mapping(address => bool) public isGovernor;
    mapping(address => bool) public isSurveyor;

    mapping(bytes32 => ParcelRecord) public parcels;
    mapping(bytes32 => bool) public geoHashRegistered;
    mapping(uint256 => bytes32) public tokenToParcelKey;

    event RoleUpdated(address indexed account, string role, bool active);
    event ParcelRegistered(
        bytes32 indexed parcelKey,
        string parcelRef,
        bytes32 ownerCommitmentHash,
        bytes32 geoBoundaryHash,
        uint256 nftTokenId,
        address indexed registrar
    );
    event OwnershipTransferred(
        bytes32 indexed parcelKey,
        uint256 indexed tokenId,
        bytes32 previousOwnerCommitment,
        bytes32 newOwnerCommitment,
        address indexed authorizedBy
    );
    event ParcelRevoked(
        bytes32 indexed parcelKey,
        uint256 indexed tokenId,
        RevocationGround ground,
        string gazetteOrderRef,
        address indexed governorAuthority
    );

    modifier onlyAdmin() {
        require(msg.sender == sysAdmin, "ANAGU: caller is not sysAdmin");
        _;
    }

    modifier onlyRegistrar() {
        require(isRegistrar[msg.sender], "ANAGU: caller lacks REGISTRAR_ROLE");
        _;
    }

    modifier onlyGovernor() {
        require(isGovernor[msg.sender], "ANAGU: caller lacks GOVERNOR_ROLE");
        _;
    }

    constructor(address _titleNFT) {
        sysAdmin = msg.sender;
        isRegistrar[msg.sender] = true;
        titleNFT = ILandTitleNFT(_titleNFT);
    }

    function setRegistrar(address account, bool active) external onlyAdmin {
        isRegistrar[account] = active;
        emit RoleUpdated(account, "REGISTRAR", active);
    }

    function setGovernor(address account, bool active) external onlyAdmin {
        isGovernor[account] = active;
        emit RoleUpdated(account, "GOVERNOR", active);
    }

    function setSurveyor(address account, bool active) external onlyAdmin {
        isSurveyor[account] = active;
        emit RoleUpdated(account, "SURVEYOR", active);
    }

    function registerParcel(
        string calldata parcelRef,
        address custodianAddress,
        bytes32 ownerCommitmentHash,
        bytes32 geoBoundaryHash,
        bytes32 documentMerkleRoot
    ) external onlyRegistrar returns (uint256 tokenId) {
        bytes32 parcelKey = keccak256(abi.encodePacked(parcelRef));
        require(parcels[parcelKey].registeredAt == 0, "ANAGU: parcel already registered");
        require(!geoHashRegistered[geoBoundaryHash], "ANAGU: duplicate spatial geometry hash");

        tokenId = titleNFT.mintTitle(custodianAddress, parcelRef, documentMerkleRoot);

        parcels[parcelKey] = ParcelRecord({
            parcelRef: parcelRef,
            ownerCommitmentHash: ownerCommitmentHash,
            geoBoundaryHash: geoBoundaryHash,
            documentMerkleRoot: documentMerkleRoot,
            nftTokenId: tokenId,
            status: ParcelStatus.Registered,
            revocationGround: RevocationGround.None,
            gazetteOrderRef: "",
            registeredAt: block.timestamp,
            revokedAt: 0
        });

        geoHashRegistered[geoBoundaryHash] = true;
        tokenToParcelKey[tokenId] = parcelKey;

        emit ParcelRegistered(
            parcelKey,
            parcelRef,
            ownerCommitmentHash,
            geoBoundaryHash,
            tokenId,
            msg.sender
        );
    }

    function authorizeTransfer(
        string calldata parcelRef,
        address fromCustodian,
        address toCustodian,
        bytes32 newOwnerCommitmentHash
    ) external onlyRegistrar {
        bytes32 parcelKey = keccak256(abi.encodePacked(parcelRef));
        ParcelRecord storage rec = parcels[parcelKey];
        require(rec.registeredAt != 0, "ANAGU: parcel not found");
        require(rec.status == ParcelStatus.Registered, "ANAGU: title is statutorily revoked");
        require(!titleNFT.isRevoked(rec.nftTokenId), "ANAGU: NFT title revoked");

        bytes32 prevCommitment = rec.ownerCommitmentHash;
        rec.ownerCommitmentHash = newOwnerCommitmentHash;

        titleNFT.registryTransfer(fromCustodian, toCustodian, rec.nftTokenId);

        emit OwnershipTransferred(
            parcelKey,
            rec.nftTokenId,
            prevCommitment,
            newOwnerCommitmentHash,
            msg.sender
        );
    }

    /**
     * @notice Executes statutory revocation strictly under Section 28 of the Nigerian Land Use Act.
     */
    function revokeParcel(
        string calldata parcelRef,
        RevocationGround ground,
        string calldata gazetteOrderRef
    ) external onlyGovernor {
        require(
            ground == RevocationGround.OverridingPublicInterest ||
            ground == RevocationGround.BreachOfStatutoryConditions,
            "ANAGU: invalid Section 28 ground"
        );
        require(bytes(gazetteOrderRef).length > 0, "ANAGU: gazette reference required");

        bytes32 parcelKey = keccak256(abi.encodePacked(parcelRef));
        ParcelRecord storage rec = parcels[parcelKey];
        require(rec.registeredAt != 0, "ANAGU: parcel not found");
        require(rec.status == ParcelStatus.Registered, "ANAGU: parcel already revoked");

        rec.status = ParcelStatus.Revoked;
        rec.revocationGround = ground;
        rec.gazetteOrderRef = gazetteOrderRef;
        rec.revokedAt = block.timestamp;

        titleNFT.revokeTitle(rec.nftTokenId);

        emit ParcelRevoked(parcelKey, rec.nftTokenId, ground, gazetteOrderRef, msg.sender);
    }
}
