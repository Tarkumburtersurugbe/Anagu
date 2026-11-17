// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title LandTitleNFT
 * @notice ERC-721 compliant digital land title token with registry-controlled transfers
 *         and permanent statutory revocation enforcement.
 */
contract LandTitleNFT {
    string public name = "ANAGU Digital Land Title";
    string public symbol = "ANAGUCT";

    address public admin;
    address public registryContract;
    uint256 private _nextTokenId = 1001;

    struct TitleMetadata {
        string parcelRef;
        bytes32 documentMerkleRoot;
        uint256 issuedAt;
        bool revoked;
    }

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => TitleMetadata) public titles;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event TitleMinted(uint256 indexed tokenId, address indexed custodian, string parcelRef);
    event TitleRevoked(uint256 indexed tokenId, uint256 timestamp);

    modifier onlyRegistry() {
        require(msg.sender == registryContract, "ANAGU NFT: caller is not LandRegistry");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function setRegistryContract(address _registry) external {
        require(msg.sender == admin, "ANAGU NFT: only admin");
        registryContract = _registry;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "ANAGU NFT: nonexistent token");
        return owner;
    }

    function balanceOf(address owner) external view returns (uint256) {
        require(owner != address(0), "ANAGU NFT: zero address");
        return _balances[owner];
    }

    function isRevoked(uint256 tokenId) external view returns (bool) {
        return titles[tokenId].revoked;
    }

    function mintTitle(
        address to,
        string calldata parcelRef,
        bytes32 metadataHash
    ) external onlyRegistry returns (uint256 tokenId) {
        require(to != address(0), "ANAGU NFT: mint to zero address");
        tokenId = _nextTokenId++;
        _owners[tokenId] = to;
        _balances[to] += 1;

        titles[tokenId] = TitleMetadata({
            parcelRef: parcelRef,
            documentMerkleRoot: metadataHash,
            issuedAt: block.timestamp,
            revoked: false
        });

        emit Transfer(address(0), to, tokenId);
        emit TitleMinted(tokenId, to, parcelRef);
    }

    /**
     * @notice Direct peer-to-peer transfers are prohibited; transfers require LandRegistry authorization.
     */
    function transferFrom(address, address, uint256) external pure {
        revert("ANAGU NFT: direct transfer disabled; use LandRegistry.authorizeTransfer");
    }

    function registryTransfer(address from, address to, uint256 tokenId) external onlyRegistry {
        require(!titles[tokenId].revoked, "ANAGU NFT: cannot transfer revoked title");
        require(_owners[tokenId] == from, "ANAGU NFT: owner mismatch");
        require(to != address(0), "ANAGU NFT: invalid recipient");

        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);
    }

    function revokeTitle(uint256 tokenId) external onlyRegistry {
        require(_owners[tokenId] != address(0), "ANAGU NFT: nonexistent token");
        require(!titles[tokenId].revoked, "ANAGU NFT: already revoked");
        titles[tokenId].revoked = true;
        emit TitleRevoked(tokenId, block.timestamp);
    }
}
